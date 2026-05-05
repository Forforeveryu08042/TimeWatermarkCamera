// ====== DOM ======
const $ = (s) => document.querySelector(s);
const video = $('#video');
const previewCanvas = $('#preview-canvas');
const resultCanvas = $('#result-canvas');
const cameraPage = $('#camera-page');
const resultPage = $('#result-page');
const gpsPrompt = $('#gps-prompt');
const gpsBtn = $('#gps-btn');
const gpsSkip = $('#gps-skip');
const btnCapture = $('#btn-capture');
const btnSwitch = $('#btn-switch');
const btnRetake = $('#btn-retake');
const btnSave = $('#btn-save');
const btnGallery = $('#btn-gallery');
const toast = $('#toast');
const focusRing = $('#focus-ring');
const wmTime = $('#wm-time');
const wmLoc = $('#wm-loc');
const tbLocation = $('#tb-location');
const tbTime = $('#tb-time');
const tbDot = $('.tb-dot');
const resultWrap = $('#result-wrap');

// ====== 状态 ======
let stream = null;
let facingMode = 'environment';
let locationText = '准备就绪';
let locationLat = null;
let locationLng = null;
let gpsGranted = false;
let clockTimer = null;
let focusTimer = null;

// ====== 初始化 ======
async function init() {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
  await startCamera();
  ipLocate();           // 立即 IP 定位
  checkGpsPermission(); // 检查是否需要引导授权
}

// ====== 时钟 ======
function updateClock() {
  const n = new Date();
  const h = pad(n.getHours()), m = pad(n.getMinutes());
  const s = pad(n.getSeconds());
  const y = n.getFullYear();
  const mo = pad(n.getMonth() + 1), d = pad(n.getDate());

  tbTime.textContent = `${h}:${m}`;
  wmTime.textContent = `${y}-${mo}-${d} ${h}:${m}:${s}`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function fullDateTime() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

// ====== 摄像头 ======
async function startCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    showToast('摄像头权限被拒绝，无法使用');
  }
}

btnSwitch.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
});

// ====== 点击屏幕对焦 ======
video.addEventListener('click', (e) => {
  const rect = video.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  focusRing.style.left = x + 'px';
  focusRing.style.top = y + 'px';
  focusRing.classList.add('show');
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => focusRing.classList.remove('show'), 800);
});

// ====== IP 定位 ======
async function ipLocate() {
  const apis = [
    { url: 'https://ipapi.co/json/', parse: d => ({ r: d.region, c: d.city, la: d.latitude, ln: d.longitude }) },
    { url: 'https://ip-api.com/json/?lang=zh-CN', parse: d => ({ r: d.regionName, c: d.city, la: d.lat, ln: d.lon }) },
    { url: 'https://api.ip.sb/geoip/', parse: d => ({ r: d.region || d.province, c: d.city, la: null, ln: null }) }
  ];

  for (const api of apis) {
    try {
      const r = await fetch(api.url);
      if (!r.ok) continue;
      const d = api.parse(await r.json());
      const parts = [];
      if (d.r) parts.push(d.r);
      if (d.c && d.c !== d.r) parts.push(d.c);
      if (parts.length > 0) {
        setLocation(parts.join(' '), d.la, d.ln);
        return;
      }
    } catch {}
  }
  setLocation('—', null, null);
}

// ====== GPS 定位 ======
function checkGpsPermission() {
  if (!navigator.geolocation) { gpsPrompt.classList.add('hidden'); return; }

  // 尝试获取位置来判断权限状态
  navigator.permissions?.query({ name: 'geolocation' }).then(p => {
    if (p.state === 'granted') {
      gpsGranted = true;
      gpsPrompt.classList.add('hidden');
      startGps();
    } else if (p.state === 'prompt') {
      gpsPrompt.classList.remove('hidden');
    } else {
      // denied — 隐藏按钮但保留跳过入口
      gpsPrompt.classList.remove('hidden');
      gpsBtn.style.display = 'none';
      gpsSkip.textContent = '跳过，使用粗略定位';
    }
  }).catch(() => {
    // permissions API 不可用，直接显示引导
    gpsPrompt.classList.remove('hidden');
  });
}

gpsBtn.addEventListener('click', async () => {
  if (!navigator.geolocation) return;
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 15000, maximumAge: 0
      });
    });
    gpsGranted = true;
    gpsPrompt.classList.add('hidden');
    await updateFromGps(pos.coords.latitude, pos.coords.longitude);
    startWatchGps();
  } catch {
    // 用户拒绝或超时
    gpsPrompt.classList.add('hidden');
    showToast('定位权限被拒绝，使用 IP 粗略定位');
  }
});

gpsSkip.addEventListener('click', () => {
  gpsPrompt.classList.add('hidden');
  if (!locationText || locationText === '准备就绪') {
    setLocation('IP 粗略定位', null, null);
  }
});

async function startGps() {
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true, timeout: 10000, maximumAge: 30000
      });
    });
    await updateFromGps(pos.coords.latitude, pos.coords.longitude);
    startWatchGps();
  } catch {}
}

function startWatchGps() {
  if (window._watchId) navigator.geolocation.clearWatch(window._watchId);
  window._watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      await updateFromGps(pos.coords.latitude, pos.coords.longitude);
    },
    () => {},
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
  );
}

async function updateFromGps(lat, lng) {
  const addr = await reverseGeocode(lat, lng);
  setLocation(addr, lat, lng);
  tbDot.classList.remove('warn');
}

// ====== 设置位置 ======
function setLocation(text, lat, lng) {
  locationText = text;
  locationLat = lat;
  locationLng = lng;
  wmLoc.textContent = text;
  tbLocation.textContent = text;
}

// ====== 逆地理编码 ======
async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=zh&addressdetails=1`,
      { headers: { 'User-Agent': 'WatermarkCamera/1.0' } }
    );
    if (r.ok) {
      const d = await r.json();
      if (d?.address) {
        const a = d.address;
        const p = [];
        if (a.state) p.push(a.state);
        if (a.city) p.push(a.city);
        if (a.county) p.push(a.county);
        if (a.town || a.district || a.suburb) p.push(a.town || a.district || a.suburb);
        if (a.road || a.pedestrian) p.push(a.road || a.pedestrian);
        if (p.length > 0) return p.join(' ');
      }
    }
  } catch {}
  // fallback
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`
    );
    if (r.ok) {
      const d = await r.json();
      const p = [];
      if (d.principalSubdivision) p.push(d.principalSubdivision);
      if (d.city) p.push(d.city);
      if (d.locality) p.push(d.locality);
      if (p.length > 0) return p.join(' ');
    }
  } catch {}
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

// ====== 拍照 ======
btnCapture.addEventListener('click', () => {
  if (!stream) return;

  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;

  previewCanvas.width = vw;
  previewCanvas.height = vh;
  const pctx = previewCanvas.getContext('2d');
  pctx.drawImage(video, 0, 0, vw, vh);

  resultCanvas.width = vw;
  resultCanvas.height = vh;
  const rctx = resultCanvas.getContext('2d');

  if (facingMode === 'user') {
    rctx.translate(vw, 0);
    rctx.scale(-1, 1);
  }
  rctx.drawImage(previewCanvas, 0, 0, vw, vh);
  if (facingMode === 'user') {
    rctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawWatermark(rctx, vw, vh);

  // 闪光效果
  const flash = document.createElement('div');
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());

  // 切换页面
  cameraPage.classList.remove('active');
  resultPage.classList.add('active');

  // 适配屏幕
  fitCanvas(resultCanvas, resultWrap);
});

// ====== 水印 ======
function drawWatermark(ctx, w, h) {
  const timeStr = fullDateTime();
  const locStr = locationText || '未知位置';

  const base = Math.max(20, Math.round(w / 38));
  const fs = Math.min(base, 58);
  const ss = Math.round(fs * 0.7);
  const px = Math.round(fs * 0.85);
  const py = Math.round(fs * 0.55);
  const gap = Math.round(fs * 0.3);
  const margin = Math.round(w * 0.032);

  ctx.textBaseline = 'top';
  ctx.font = `600 ${fs}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  const tm = ctx.measureText(timeStr);
  ctx.font = `${ss}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  const lm = ctx.measureText(locStr);

  const bw = Math.max(tm.width, lm.width) + px * 2;
  const bh = fs + ss + gap + py * 2;
  const bx = margin;
  const by = h - margin - bh;

  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.48)';
  rr(ctx, bx, by, bw, bh, Math.round(fs * 0.45));
  ctx.fill();

  // 竖线
  const lx = bx + Math.round(fs * 0.28);
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(lx, by + Math.round(bh * 0.15), Math.round(fs * 0.07), Math.round(bh * 0.7));

  // 时间
  const tx = lx + Math.round(fs * 0.5);
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${fs}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  ctx.fillText(timeStr, tx, by + py);

  // 地点
  ctx.font = `${ss}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(locStr, tx, by + py + fs + gap);
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ====== 适配结果画布 ======
function fitCanvas(canvas, wrap) {
  const mw = wrap.clientWidth - 32;
  const mh = wrap.clientHeight - 64;
  const ratio = Math.min(mw / canvas.width, mh / canvas.height);
  canvas.style.width = canvas.width * ratio + 'px';
  canvas.style.height = canvas.height * ratio + 'px';
}

// ====== 重拍 ======
btnRetake.addEventListener('click', () => {
  resultPage.classList.remove('active');
  cameraPage.classList.add('active');
});

// ====== 保存 ======
btnSave.addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = `watermark_${Date.now()}.jpg`;
  a.href = resultCanvas.toDataURL('image/jpeg', 0.95);
  a.click();
  showToast('已保存到相册');
});

// ====== 给已有照片加水印 ======
btnGallery.addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        resultCanvas.width = img.naturalWidth;
        resultCanvas.height = img.naturalHeight;
        const rctx = resultCanvas.getContext('2d');
        rctx.drawImage(img, 0, 0);
        drawWatermark(rctx, resultCanvas.width, resultCanvas.height);
        cameraPage.classList.remove('active');
        resultPage.classList.add('active');
        fitCanvas(resultCanvas, resultWrap);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  inp.click();
});

// ====== Toast ======
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

// ====== SW ======
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ====== 窗口大小变化时重算画布 ======
window.addEventListener('resize', () => {
  if (resultPage.classList.contains('active')) {
    fitCanvas(resultCanvas, resultWrap);
  }
});

init();
