import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { AgentConfig } from '@/constants/agent-config'

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

async function registerTokenWithServer(token: string): Promise<void> {
  try {
    const res = await fetch(`${AgentConfig.apiUrl}/device/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': AgentConfig.apiKey,
      },
      body: JSON.stringify({ push_token: token }),
    })
    if (res.ok) {
      console.log('[notifications] Push token registered with server:', token)
    } else {
      console.warn('[notifications] Server rejected token registration:', res.status)
    }
  } catch (e) {
    console.error('[notifications] Failed to register token with server:', e)
  }
}

export function NotificationProvider() {
  useEffect(() => {
    registerForPushNotifications().then((token) => {
      if (token) registerTokenWithServer(token)
    })

    // When the user taps a notification and the app opens from background/killed,
    // the WS reconnects automatically. The server re-delivers any pending
    // tx_signing_request on reconnect, which shows the signing modal automatically.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data
      console.log('[notifications] Notification tapped, type:', data?.type, 'tx_id:', data?.tx_id)
    })

    return () => subscription.remove()
  }, [])

  return null
}
