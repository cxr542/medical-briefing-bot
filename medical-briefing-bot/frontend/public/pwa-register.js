if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch((error) => {
    console.error('의료 브리핑 오프라인 안내를 준비하지 못했습니다.', error);
  });
}
