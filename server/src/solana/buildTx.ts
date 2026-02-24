import {
  createSolanaRpc,
  address,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  AccountRole,
  type Address,
} from "@solana/kit";

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

export const rpc = createSolanaRpc(RPC_URL);

// Hardcoded for the test phase — Phase 4 will take these from the alert + wallet
const SENDER    = address("2veHWtQJQMVz5c488d7ihMyvFV29JFYGs7tTHZJ8sMX2");
const RECIPIENT = address("7WKaHxMy54Mn5JPpETqiwwkcyJLmkcsrjwfvUnDqPpdN");
const AMOUNT    = 10_000_000n; // 0.01 SOL in lamports

const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/**
 * Build a System Program Transfer instruction from kit primitives.
 * Wire layout: [u32 LE: instruction index 2] [u64 LE: lamports]
 *
 * Avoids @solana-program/system which has a type-generation version mismatch
 * with the current @solana/kit release.
 */
function buildTransferInstruction(from: Address, to: Address, lamports: bigint) {
  const data = new Uint8Array(12);
  const view = new DataView(data.buffer);
  view.setUint32(0, 2, true);          // Transfer = instruction index 2
  view.setBigUint64(4, lamports, true); // amount

  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: from, role: AccountRole.WRITABLE_SIGNER },
      { address: to,   role: AccountRole.WRITABLE },
    ],
    data,
  };
}

/**
 * Builds an unsigned v0 VersionedTransaction transferring 0.01 SOL on devnet.
 *
 * The signature slot for the fee payer is zero-filled — MWA on the mobile
 * side deserializes, signs with the user's key, then broadcasts.
 *
 * Returns: base64-encoded Solana wire-format transaction
 */
export async function buildTestTransferTx(): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayer(SENDER, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    (tx) =>
      appendTransactionMessageInstruction(
        buildTransferInstruction(SENDER, RECIPIENT, AMOUNT),
        tx
      )
  );

  const compiledTx = compileTransaction(transactionMessage);

  // getBase64EncodedWireTransaction is typed for FullySignedTransaction but
  // the wire encoding is identical for unsigned txs: zero-filled sig slots.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getBase64EncodedWireTransaction(compiledTx as any);
}
