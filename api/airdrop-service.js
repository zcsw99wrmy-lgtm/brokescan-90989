// api/airdrop-service.js
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { readLb } from './leaderboard.js';
import { appendHistoryRecord } from './airdrop-history.js';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const AIRDROP_AMOUNT_SOL_DEFAULT = parseFloat(process.env.AIRDROP_AMOUNT_SOL || '0.5');
const TREASURY_SECRET = process.env.TREASURY_PRIVATE_KEY; // base58-строка секретного ключа

function getTreasuryKeypair() {
  if (!TREASURY_SECRET) throw new Error('TREASURY_PRIVATE_KEY не задан в переменных окружения');
  return Keypair.fromSecretKey(bs58.decode(TREASURY_SECRET));
}

/**
 * Выбирает случайного участника из текущего лидерборда (Vercel Blob).
 * @param {Object} opts
 * @param {number} opts.poolSize - ограничить пул топ-N по tweetCount/активности (0 = все с кошельком)
 * @param {string[]} opts.excludeHandles - доп. исключения
 * @param {string[]} opts.recentWinners - handle'ы, которых пропускаем (cooldown)
 */
export async function pickRandomRecipient(opts = {}) {
  const { poolSize = 0, excludeHandles = [], recentWinners = [] } = opts;
  const lb = await readLb();

  let entries = Object.values(lb).filter(
    (e) => e && e.wallet && !recentWinners.includes(e.handle) && !excludeHandles.includes(e.handle)
  );

  if (poolSize > 0) {
    entries = entries
      .sort((a, b) => (b.tweetCount || 0) - (a.tweetCount || 0))
      .slice(0, poolSize);
  }

  if (entries.length === 0) return null;
  const idx = Math.floor(Math.random() * entries.length);
  return entries[idx];
}

/**
 * Отправляет SOL на кошелёк получателя. Возвращает подпись транзакции.
 */
export async function sendSol(toWalletAddress, amountSol = AIRDROP_AMOUNT_SOL_DEFAULT) {
  const treasuryKeypair = getTreasuryKeypair();
  const connection = new Connection(RPC_URL, 'confirmed');
  const toPubkey = new PublicKey(toWalletAddress);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: treasuryKeypair.publicKey,
      toPubkey,
      lamports,
    })
  );

  return sendAndConfirmTransaction(connection, tx, [treasuryKeypair], { commitment: 'confirmed' });
}

/**
 * Полный цикл: выбрать случайного участника → отправить SOL → записать в историю.
 * Баланс в /api/leaderboard не хранится и не трогается — он и так
 * подтягивается фронтендом live через /api/wallet-pnl при следующем опросе,
 * так что новый баланс получателя появится в топе сам собой.
 */
export async function runRandomAirdrop(opts = {}) {
  const recipient = await pickRandomRecipient(opts);
  if (!recipient) {
    return { ok: false, reason: 'no_eligible_recipient' };
  }

  const amountSol = opts.amountSol || AIRDROP_AMOUNT_SOL_DEFAULT;

  let signature;
  try {
    signature = await sendSol(recipient.wallet, amountSol);
  } catch (err) {
    return { ok: false, reason: 'send_failed', error: err.message };
  }

  // Пишем в историю для ленты "Recent Sends" на фронте.
  // Не критичный путь: если запись лога упадёт, транзакция уже прошла,
  // поэтому не оборачиваем это в try/catch, который бы менял ok на false —
  // appendHistoryRecord сам глотает свои ошибки и логирует их.
  await appendHistoryRecord({
    handle: recipient.handle,
    name: recipient.name || recipient.handle,
    avatar: recipient.avatar || '',
    wallet: recipient.wallet,
    amountSol,
    signature,
  });

  return {
    ok: true,
    handle: recipient.handle,
    wallet: recipient.wallet,
    amountSol,
    signature,
  };
}
