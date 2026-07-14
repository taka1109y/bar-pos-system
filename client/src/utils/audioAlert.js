let _audioCtx = null;
export function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new AudioContext();
  return _audioCtx;
}

function playBeep(ctx) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
  osc.start();
  osc.stop(ctx.currentTime + 0.4);
}

export function playNotification() {
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => playBeep(ctx));
    } else {
      playBeep(ctx);
    }
  } catch { /* noop */ }
}

// アプリ全体で一度だけ呼び出す。ページ内のどんな操作(SPA内リンクのクリック自体を含む)でも
// AudioContextをアンロックしておくことで、キッチン画面へ遷移した直後の初回通知からでも
// 確実に音が鳴るようにする(遷移後に別途タップし直す必要をなくす)。
export function initAudioUnlock() {
  const unlock = () => {
    getAudioCtx().resume().catch(() => {});
  };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('touchend', unlock, { once: true });

  // タブが非表示→可視化された際に、ブラウザ側でサスペンドされたAudioContextを再開する
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      getAudioCtx().resume().catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('touchend', unlock);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
