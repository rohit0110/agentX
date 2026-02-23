import { StyleSheet, View } from 'react-native'
import { AppText } from '@/components/app-text'
import { useThemeColor } from '@/hooks/use-theme-color'
import { ChatMessage } from './agent-provider'

export function AgentMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const agentBubbleBg = useThemeColor({}, 'border')
  const agentTextColor = useThemeColor({}, 'text')

  return (
    <View style={[styles.row, isUser ? styles.userRow : styles.agentRow]}>
      <View style={[styles.bubble, { backgroundColor: isUser ? '#0a7ea4' : agentBubbleBg }]}>
        <AppText style={{ color: isUser ? '#ffffff' : agentTextColor, fontSize: 15, lineHeight: 22 }}>
          {message.content}
          {message.streaming ? '▌' : ''}
        </AppText>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 4 },
  userRow: { alignItems: 'flex-end' },
  agentRow: { alignItems: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
})
