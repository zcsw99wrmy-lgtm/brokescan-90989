// api/cron-airdrop.js
//
// Автоматические серверные выплаты отключены.
// Этот endpoint намеренно ничего не отправляет, даже если он всё ещё указан
// в vercel.json. Выплаты запускаются только из test-airdrop.html через
// защищённый POST /api/random-airdrop.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  return res.status(200).json({
    ok: true,
    disabled: true,
    message: 'Server cron airdrops are disabled. Use the manual control panel.',
  });
}
