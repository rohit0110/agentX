import { useMobileWallet } from '@wallet-ui/react-native-web3js'
import { createContext, PropsWithChildren, use, useMemo } from 'react'

export interface AuthState {
  isAuthenticated: boolean
  isLoading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

const Context = createContext<AuthState>({} as AuthState)

export function useAuth() {
  const value = use(Context)
  if (!value) throw new Error('useAuth must be wrapped in <AuthProvider />')
  return value
}

export function AuthProvider({ children }: PropsWithChildren) {
  const { account, connect, disconnect } = useMobileWallet()

  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: !!account,
      isLoading: false,
      signIn: async () => {
        await connect()
      },
      signOut: async () => {
        await disconnect()
      },
    }),
    [account, connect, disconnect],
  )

  return <Context value={value}>{children}</Context>
}
