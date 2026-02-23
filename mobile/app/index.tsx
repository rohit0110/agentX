import { Redirect } from 'expo-router'
import { useAuth } from '@/components/auth/auth-provider'

export default function Index() {
  const { isAuthenticated } = useAuth()
  return <Redirect href={isAuthenticated ? '/(tabs)/chat' : '/sign-in'} />
}
