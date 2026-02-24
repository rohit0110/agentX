import AsyncStorage from '@react-native-async-storage/async-storage'
import { VersionedTransaction } from '@solana/web3.js'
import { Base64 } from 'js-base64'
import { createContext, PropsWithChildren, use, useCallback, useEffect, useRef, useState } from 'react'
import { AgentConfig } from '@/constants/agent-config'
import { useMobileWallet } from '@wallet-ui/react-native-web3js'

export interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  streaming: boolean
}

export interface ToolActivity {
  tool: string
  input: unknown
}

export interface TxSigningRequest {
  tx_id: string
  from_token: string
  to_token: string
  amount: number
  serialized_tx: string
  trigger: {
    alert_id: number
    token: string
    target_price: number
    triggered_price: number
    direction: 'above' | 'below'
  }
  expires_at: string
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

interface AgentContextValue {
  messages: ChatMessage[]
  toolActivity: ToolActivity | null
  isThinking: boolean
  status: ConnectionStatus
  sendPrompt: (text: string) => void
  pendingTx: TxSigningRequest | null
  approveTx: () => Promise<void>
  rejectTx: (reason?: string) => void
}

const AgentContext = createContext<AgentContextValue>({} as AgentContextValue)

export function useAgent() {
  const value = use(AgentContext)
  if (!value) throw new Error('useAgent must be used inside <AgentProvider />')
  return value
}

const SESSION_KEY = 'agentx:session_id'

async function getOrCreateSessionId(): Promise<string> {
  const existing = await AsyncStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const id = crypto.randomUUID()
  await AsyncStorage.setItem(SESSION_KEY, id)
  return id
}

function isExpired(expires_at: string): boolean {
  return Date.now() > new Date(expires_at).getTime()
}

export function AgentProvider({ children }: PropsWithChildren) {
  const { signAndSendTransaction } = useMobileWallet()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [toolActivity, setToolActivity] = useState<ToolActivity | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [pendingTx, setPendingTx] = useState<TxSigningRequest | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pendingTxRef = useRef<TxSigningRequest | null>(null)

  function setPending(req: TxSigningRequest | null) {
    pendingTxRef.current = req
    setPendingTx(req)
  }

  // Load session ID and history on mount
  useEffect(() => {
    getOrCreateSessionId().then(async (id) => {
      sessionIdRef.current = id
      try {
        const res = await fetch(`${AgentConfig.apiUrl}/agent/history`, {
          headers: { 'X-Api-Key': AgentConfig.apiKey },
        })
        if (!res.ok) return
        const data = await res.json()
        const filtered = (data.messages as Array<{ id: number; session_id: string; role: string; content: string }>)
          .filter((m) => m.session_id === id)
          .map((m) => ({ id: String(m.id), role: m.role as 'user' | 'agent', content: m.content, streaming: false }))
        setMessages(filtered)
      } catch {
        // history load is best-effort
      }
    })
  }, [])

  // WebSocket — connect on mount, reconnect with exponential backoff
  useEffect(() => {
    let destroyed = false
    let reconnectDelay = 1_000

    function connect() {
      if (destroyed) return
      setStatus('connecting')

      // React Native WebSocket supports a third `options` arg for headers (not in DOM types)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws: WebSocket = new (WebSocket as any)(AgentConfig.wsUrl, undefined, {
        headers: { 'X-Api-Key': AgentConfig.apiKey },
      })
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('connected')
        reconnectDelay = 1_000
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as { type: string; payload: Record<string, unknown> }
          switch (msg.type) {
            case 'agent_delta': {
              const text = msg.payload.text as string
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.streaming) return [...prev.slice(0, -1), { ...last, content: last.content + text }]
                return [...prev, { id: crypto.randomUUID(), role: 'agent', content: text, streaming: true }]
              })
              break
            }
            case 'agent_done': {
              const text = msg.payload.text as string
              setMessages((prev) => {
                const last = prev[prev.length - 1]
                if (last?.streaming) return [...prev.slice(0, -1), { ...last, content: text, streaming: false }]
                return prev
              })
              setIsThinking(false)
              setToolActivity(null)
              break
            }
            case 'tool_call':
              setToolActivity({ tool: msg.payload.tool as string, input: msg.payload.input })
              break
            case 'tool_result':
              setToolActivity(null)
              break
            case 'error':
              setIsThinking(false)
              setToolActivity(null)
              break
            case 'tx_signing_request': {
              const req = msg.payload as unknown as TxSigningRequest
              if (isExpired(req.expires_at)) {
                wsRef.current?.send(
                  JSON.stringify({ type: 'tx_rejected', payload: { tx_id: req.tx_id, reason: 'expired' } }),
                )
              } else {
                setPending(req)
              }
              break
            }
          }
        } catch {
          // ignore malformed frames
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        setStatus('disconnected')
        if (!destroyed) {
          setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000)
            connect()
          }, reconnectDelay)
        }
      }
    }

    connect()
    return () => {
      destroyed = true
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  const approveTx = useCallback(async () => {
    const req = pendingTxRef.current
    if (!req) return

    if (isExpired(req.expires_at)) {
      wsRef.current?.send(
        JSON.stringify({ type: 'tx_rejected', payload: { tx_id: req.tx_id, reason: 'expired' } }),
      )
      setPending(null)
      return
    }

    try {
      const tx = VersionedTransaction.deserialize(Base64.toUint8Array(req.serialized_tx))
      const signature = await signAndSendTransaction(tx, 0)
      wsRef.current?.send(
        JSON.stringify({ type: 'tx_signed', payload: { tx_id: req.tx_id, signature } }),
      )
    } catch (e) {
      console.error('[agent] tx sign failed:', e)
      wsRef.current?.send(
        JSON.stringify({ type: 'tx_rejected', payload: { tx_id: req.tx_id, reason: 'sign_failed' } }),
      )
    }

    setPending(null)
  }, [signAndSendTransaction])

  const rejectTx = useCallback((reason = 'user_declined') => {
    const req = pendingTxRef.current
    if (!req) return
    wsRef.current?.send(
      JSON.stringify({ type: 'tx_rejected', payload: { tx_id: req.tx_id, reason } }),
    )
    setPending(null)
  }, [])

  const sendPrompt = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const sessionId = sessionIdRef.current ?? crypto.randomUUID()
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', content: trimmed, streaming: false }])
    setIsThinking(true)
    wsRef.current?.send(JSON.stringify({ type: 'prompt', payload: { prompt: trimmed, session_id: sessionId } }))
  }, [])

  return (
    <AgentContext value={{ messages, toolActivity, isThinking, status, sendPrompt, pendingTx, approveTx, rejectTx }}>
      {children}
    </AgentContext>
  )
}
