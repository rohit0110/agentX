const fs = require('fs')
const path = require('path')

const root = process.cwd()
const appDir = path.join(root, 'app')
const appExampleDir = path.join(root, 'app-example')

async function main() {
  // Remove existing app-example if present
  if (fs.existsSync(appExampleDir)) {
    fs.rmSync(appExampleDir, { recursive: true, force: true })
    console.log('Removed existing app-example/')
  }

  // Archive current app/ → app-example/
  fs.renameSync(appDir, appExampleDir)
  console.log('Moved app/ → app-example/')

  // Create fresh minimal app/
  fs.mkdirSync(appDir)
  fs.writeFileSync(
    path.join(appDir, 'index.tsx'),
    `import { Text, View } from 'react-native'\n\nexport default function Index() {\n  return (\n    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>\n      <Text>Edit app/index.tsx to get started.</Text>\n    </View>\n  )\n}\n`
  )
  console.log('Created fresh app/ with index.tsx')
  console.log('\nDone. Rebuild your screens in app/')
}

main()
