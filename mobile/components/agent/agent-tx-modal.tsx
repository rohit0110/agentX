import { Modal, StyleSheet, TouchableOpacity, View } from 'react-native'
import { useAgent } from '@/components/agent/agent-provider'
import { AppText } from '@/components/app-text'
import { AppView } from '@/components/app-view'
import { useThemeColor } from '@/hooks/use-theme-color'

export function AgentTxModal() {
  const { pendingTx, approveTx, rejectTx } = useAgent()
  const borderColor = useThemeColor({}, 'icon')

  if (!pendingTx) return null

  const { from_token, to_token, amount, trigger, expires_at } = pendingTx
  const expiresAt = new Date(expires_at).toLocaleTimeString()

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => rejectTx()}>
      <View style={styles.overlay}>
        <AppView style={[styles.card, { borderColor }]}>
          <AppText type="title">Sign Transaction</AppText>

          <View style={styles.section}>
            <AppText type="defaultSemiBold">Swap</AppText>
            <AppText>
              {amount} {from_token} → {to_token}
            </AppText>
          </View>

          <View style={styles.section}>
            <AppText type="defaultSemiBold">Trigger</AppText>
            <AppText>
              {trigger.token} went {trigger.direction} ${trigger.target_price.toFixed(2)}
            </AppText>
            <AppText>Triggered at ${trigger.triggered_price.toFixed(2)}</AppText>
          </View>

          <View style={styles.section}>
            <AppText type="defaultSemiBold">Expires</AppText>
            <AppText>{expiresAt}</AppText>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.reject]} onPress={() => rejectTx()}>
              <AppText>Decline</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.approve]} onPress={approveTx}>
              <AppText style={{ color: '#fff' }}>Sign & Send</AppText>
            </TouchableOpacity>
          </View>
        </AppView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  card: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    gap: 16,
    padding: 24,
    paddingBottom: 40,
  },
  section: {
    gap: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 14,
  },
  reject: {
    backgroundColor: 'rgba(255,59,48,0.15)',
  },
  approve: {
    backgroundColor: '#007AFF',
  },
})
