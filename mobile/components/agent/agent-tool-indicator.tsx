import { StyleSheet, View } from 'react-native'
import { AppText } from '@/components/app-text'
import { useThemeColor } from '@/hooks/use-theme-color'
import { ToolActivity } from './agent-provider'

const TOOL_LABELS: Record<string, string> = {
  getSolanaPrice: 'Fetching price',
  buildMockSwapTx: 'Building swap transaction',
  readFile: 'Reading file',
  writeFile: 'Writing file',
}

export function AgentToolIndicator({ toolActivity, isThinking }: { toolActivity: ToolActivity | null; isThinking: boolean }) {
  const borderColor = useThemeColor({}, 'border')
  const textColor = useThemeColor({}, 'icon')
  if (!isThinking && !toolActivity) return null
  const label = toolActivity ? `${TOOL_LABELS[toolActivity.tool] ?? toolActivity.tool}...` : 'Thinking...'
  return (
    <View style={[styles.container, { borderTopColor: borderColor }]}>
      <AppText style={{ color: textColor, fontSize: 13 }}>{label}</AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
})
