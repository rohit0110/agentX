import { PortalHost } from '@rn-primitives/portal'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AppProviders } from '@/components/app-providers'
import { AgentTxModal } from '@/components/agent/agent-tx-modal'
import { useEffect } from 'react'
import * as SplashScreen from 'expo-splash-screen'
import { View } from 'react-native'
import { useAuth } from '@/components/auth/auth-provider'

SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  })

  if (!loaded) return null

  return (
    <View style={{ flex: 1 }}>
      <AppProviders>
        <RootNavigator />
        <AgentTxModal />
        <StatusBar style="auto" />
      </AppProviders>
      <PortalHost />
    </View>
  )
}

function RootNavigator() {
  const { isLoading } = useAuth()

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync()
  }, [isLoading])

  if (isLoading) return null

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="sign-in" />
    </Stack>
  )
}
