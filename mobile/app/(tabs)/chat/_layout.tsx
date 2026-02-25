import { Stack } from 'expo-router'

export default function ChatLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerTitle: 'agentX' }} />
    </Stack>
  )
}
