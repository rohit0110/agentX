import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { AgentConfig } from '@/constants/agent-config'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'

// Suppress the notification banner when the app is in the foreground —
// the WS message already shows the signing modal directly.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'agentX',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  console.log('[notifications] existing permission status:', existingStatus)

  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
    console.log('[notifications] requested permission, got:', finalStatus)
  }

  if (finalStatus !== 'granted') {
    console.warn('[notifications] Permission not granted — push notifications disabled')
    return null
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
  console.log('[notifications] using projectId:', projectId)

  try {
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    console.log('[notifications] got push token:', token.data)
    return token.data
  } catch (e) {
    console.error('[notifications] Failed to get push token:', e)
    return null
  }
}

async function registerTokenWithServer(token: string, walletAddress?: string): Promise<void> {
  try {
    const body: Record<string, string> = { push_token: token }
    if (walletAddress) body.wallet_address = walletAddress

    const res = await fetch(`${AgentConfig.apiUrl}/device/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': AgentConfig.apiKey,
      },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      console.log('[notifications] Registered with server — token:', token, 'wallet:', walletAddress ?? 'none')
    } else {
      console.warn('[notifications] Server rejected token registration:', res.status)
    }
  } catch (e) {
    console.error('[notifications] Failed to register token with server:', e)
  }
}

export function NotificationProvider() {
  const { account } = useMobileWallet()
  const [pushToken, setPushToken] = useState<string | null>(null)
  // Track the last wallet address we registered with to avoid redundant calls
  const registeredWalletRef = useRef<string | null>(null)

  // Obtain push token on mount and do an initial registration
  useEffect(() => {
    registerForPushNotifications().then((token) => {
      if (!token) return
      setPushToken(token)
      const walletAddress = account?.address?.toString()
      registeredWalletRef.current = walletAddress ?? null
      registerTokenWithServer(token, walletAddress)
    })

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data
      console.log('[notifications] Notification tapped, type:', data?.type, 'tx_id:', data?.tx_id)
    })

    return () => subscription.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-register when the wallet connects or changes, so the server always has the latest address
  useEffect(() => {
    if (!pushToken) return
    const walletAddress = account?.address?.toString() ?? null
    if (walletAddress === registeredWalletRef.current) return
    registeredWalletRef.current = walletAddress
    registerTokenWithServer(pushToken, walletAddress ?? undefined)
  }, [account, pushToken])

  return null
}
