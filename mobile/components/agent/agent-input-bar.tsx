import { useState } from 'react'
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native'
import { useThemeColor } from '@/hooks/use-theme-color'
import { AppText } from '@/components/app-text'
import { ConnectionStatus } from './agent-provider'

interface Props {
  onSend: (text: string) => void
  disabled?: boolean
  status: ConnectionStatus
}

export function AgentInputBar({ onSend, disabled, status }: Props) {
  const [text, setText] = useState('')
  const borderColor = useThemeColor({}, 'border')
  const backgroundColor = useThemeColor({}, 'background')
  const textColor = useThemeColor({}, 'text')
  const tintColor = useThemeColor({}, 'tint')
  const iconColor = useThemeColor({}, 'icon')

  const canSend = text.trim().length > 0 && !disabled

  function handleSend() {
    if (!canSend) return
    onSend(text)
    setText('')
  }

  const placeholder =
    status === 'connecting' ? 'Connecting...' : status === 'disconnected' ? 'Reconnecting...' : 'Ask OpenClaw...'

  return (
    <View style={[styles.container, { borderTopColor: borderColor, backgroundColor }]}>
      <TextInput
        style={[styles.input, { color: textColor, borderColor }]}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={iconColor}
        multiline
        blurOnSubmit
        returnKeyType="send"
        onSubmitEditing={handleSend}
        editable={!disabled && status === 'connected'}
      />
      <TouchableOpacity
        style={[styles.button, { backgroundColor: canSend ? tintColor : borderColor }]}
        onPress={handleSend}
        disabled={!canSend}
        activeOpacity={0.8}
      >
        <AppText style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Send</AppText>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
})
