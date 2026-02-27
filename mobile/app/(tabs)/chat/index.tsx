import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { useRef } from 'react'
import { useAgent } from '@/components/agent/agent-provider'
import { AgentMessageBubble } from '@/components/agent/agent-message-bubble'
import { AgentToolIndicator } from '@/components/agent/agent-tool-indicator'
import { AgentInputBar } from '@/components/agent/agent-input-bar'
import { AppText } from '@/components/app-text'
import { useThemeColor } from '@/hooks/use-theme-color'

export default function ChatScreen() {
  const { messages, toolActivity, isThinking, status, sendPrompt } = useAgent()
  const listRef = useRef<FlatList>(null)

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => <AgentMessageBubble message={item} />}
        contentContainerStyle={messages.length === 0 ? styles.emptyList : styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<EmptyState status={status} />}
      />
      <AgentToolIndicator toolActivity={toolActivity} isThinking={isThinking} />
      <AgentInputBar onSend={sendPrompt} disabled={status !== 'connected' || isThinking} status={status} />
    </KeyboardAvoidingView>
  )
}

function EmptyState({ status }: { status: string }) {
  const textColor = useThemeColor({}, 'icon')
  const label =
    status === 'connected'
      ? 'Ask agentX to fetch prices, build swap transactions, or discuss trading strategies.'
      : status === 'connecting'
        ? 'Connecting to agent...'
        : 'Reconnecting...'
  return (
    <View style={styles.empty}>
      <AppText style={{ color: textColor, textAlign: 'center', lineHeight: 22 }}>{label}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingVertical: 12 },
  emptyList: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
})
