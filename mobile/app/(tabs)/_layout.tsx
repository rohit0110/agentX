import { Tabs } from 'expo-router'
import { UiIconSymbol } from '@/components/ui/ui-icon-symbol'

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Agent',
          tabBarIcon: ({ color }) => (
            <UiIconSymbol size={28} name="bubble.left.and.bubble.right.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  )
}
