import { clusterApiUrl } from '@solana/web3.js'
import { Cluster } from '@/components/cluster/cluster'
import { ClusterNetwork } from '@/components/cluster/cluster-network'

export class AppConfig {
  static name = 'mobile'
  static uri = 'https://example.com'
  static clusters: Cluster[] = [
    {
      id: 'solana:mainnet',
      name: 'Mainnet',
      endpoint: clusterApiUrl('mainnet-beta'),
      network: ClusterNetwork.Mainnet,
    },
  ]
}
