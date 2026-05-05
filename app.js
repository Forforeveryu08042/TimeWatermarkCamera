// ====== DOM ======
const $ = s => document.querySelector(s);
const video = $('#video');
const previewCanvas = $('#preview-canvas');
const resultCanvas = $('#result-canvas');
const cameraPage = $('#camera-page');
const resultPage = $('#result-page');
const gpsGuide = $('#gps-guide');
const gpsBtn = $('#gps-btn');
const gpsDot = $('#gps-dot');
const gpsText = $('#gps-text');
const titleEdit = $('#title-edit');
const titleInput = $('#title-input');
const titleSave = $('#title-save');
const btnTitle = $('#btn-title');
const btnCapture = $('#btn-capture');
const btnSwitch = $('#btn-switch');
const btnRetake = $('#btn-retake');
const btnSave = $('#btn-save');
const toast = $('#toast');
const resultWrap = $('#result-wrap');

// ====== 状态 ======
let stream = null;
let facingMode = 'environment';
let clockTimer = null;
let weatherTimer = null;

let gpsReady = false;
let locAddress = '';    // 逆地理编码后的地址
let locLat = null;
let locLng = null;

let weatherDesc = '获取中';
let weatherTemp = null;

let wmTitle = localStorage.getItem('wm_title') || '工程记录';

// 天气代码映射
const WEATHER_MAP = {
  0: '晴', 1: '晴', 2: '多云', 3: '阴',
  45: '雾', 48: '雾凇',
  51: '小雨', 53: '小雨', 55: '小雨',
  61: '雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  80: '阵雨', 81: '阵雨', 82: '暴雨',
  95: '雷阵雨', 96: '冰雹', 99: '大冰雹'
};

// ====== 初始化 ======
async function init() {
  updateClock();
  clockTimer = setInterval(updateClock, 1000);
  await startCamera();
  startGps();
}

// ====== 时钟 ======
function updateClock() {
  const n = new Date();
  $('#wm-time-preview').textContent =
    `${n.getFullYear()}.${pad(n.getMonth()+1)}.${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

function pad(n) { return String(n).padStart(2,'0'); }

function nowTimeStr() {
  const n = new Date();
  return `${n.getFullYear()}.${pad(n.getMonth()+1)}.${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}

// ====== 摄像头 ======
async function startCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width:{ideal:1920}, height:{ideal:1080} },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch { showToast('摄像头权限被拒绝'); }
}

btnSwitch.addEventListener('click', () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  startCamera();
});

// ====== GPS 定位（唯一来源，不用IP） ======
async function startGps() {
  if (!navigator.geolocation) {
    setGpsState('err', 'GPS不可用');
    return;
  }

  // 检查权限
  try {
    const perm = await navigator.permissions?.query({ name:'geolocation' });
    if (perm) {
      if (perm.state === 'denied') {
        setGpsState('err', '位置权限已拒绝');
        showToast('请在系统设置中允许位置权限');
        return;
      }
      if (perm.state === 'granted') {
        // 已有权限，直接定位
        setGpsState('waiting', '获取位置中...');
        await doGpsFix();
        return;
      }
    }
  } catch {}

  // 需要引导用户授权
  setGpsState('waiting', '等待授权');
  gpsGuide.classList.remove('hidden');

  gpsBtn.onclick = async () => {
    gpsGuide.classList.add('hidden');
    setGpsState('waiting', '获取位置中...');
    await doGpsFix();
  };
}

async function doGpsFix() {
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0  // 强制获取新位置，不用缓存
      });
    });
    await onGpsSuccess(pos.coords.latitude, pos.coords.longitude);
  } catch (e) {
    console.warn('GPS fix failed:', e.message);
    setGpsState('err', '定位失败，点击重试');
    // 点击状态栏重试
    gpsText.onclick = () => {
      setGpsState('waiting', '获取位置中...');
      doGpsFix();
    };
    gpsText.style.cursor = 'pointer';
    showToast('GPS信号弱，请到室外或窗边');
  }
}

async function onGpsSuccess(lat, lng) {
  locLat = lat;
  locLng = lng;
  gpsReady = true;
  setGpsState('ok', 'GPS已定位');

  // 逆地理编码
  const addr = await reverseGeocode(lat, lng);
  locAddress = addr;
  $('#wm-loc-preview').textContent = addr;

  // 获取天气
  fetchWeather(lat, lng);

  // 持续监听位置变化
  startWatchGps();
}

function startWatchGps() {
  if (window._watchId) navigator.geolocation.clearWatch(window._watchId);
  window._watchId = navigator.geolocation.watchPosition(
    async pos => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      // 移动超过50米才更新
      if (locLat && haversine(locLat, locLng, lat, lng) < 0.05) return;
      locLat = lat;
      locLng = lng;
      locAddress = await reverseGeocode(lat, lng);
      $('#wm-loc-preview').textContent = locAddress;
      fetchWeather(lat, lng);
    },
    () => {},
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
  );
}

function setGpsState(state, text) {
  gpsDot.className = 'gps-dot';
  if (state === 'ok') gpsDot.classList.add('ok');
  if (state === 'err') gpsDot.classList.add('err');
  gpsText.textContent = text;
}

// 两坐标距离 (km)
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function rad(d) { return d * Math.PI / 180; }

// ====== 逆地理编码 ======
async function reverseGeocode(lat, lng) {
  // Nominatim — 免费，精度高
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=19&accept-language=zh&addressdetails=1`,
      { headers: { 'User-Agent': 'WatermarkCamera/1.0' } }
    );
    if (r.ok) {
      const d = await r.json();
      if (d?.address) {
        const a = d.address;
        // 构建详细地址：省 市 区 · 街道/路 · 建筑/小区
        const major = [];
        if (a.state) major.push(a.state.replace(/省|市$/, ''));
        if (a.city) major.push(a.city.replace(/市$/, ''));
        if (a.county) major.push(a.county);
        if (a.town || a.district || a.suburb) major.push(a.town || a.district || a.suburb);

        const detail = [];
        if (a.road) detail.push(a.road);
        if (a.neighbourhood) detail.push(a.neighbourhood);
        if (a.building || a.house_number) detail.push(a.building || a.house_number);

        let result = major.join('');
        if (detail.length > 0) result += '·' + detail.join('·');
        return result || d.display_name?.split(',').slice(0,3).join(' ') || `${lat.toFixed(5)},${lng.toFixed(5)}`;
      }
    }
  } catch {}

  // 备用
  try {
    const r = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`
    );
    if (r.ok) {
      const d = await r.json();
      const parts = [];
      if (d.principalSubdivision) parts.push(d.principalSubdivision);
      if (d.city) parts.push(d.city);
      if (d.locality) parts.push(d.locality);
      if (parts.length > 0) return parts.join('');
    }
  } catch {}

  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

// ====== 天气 ======
async function fetchWeather(lat, lng) {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`
    );
    if (r.ok) {
      const d = await r.json();
      const c = d.current;
      weatherDesc = WEATHER_MAP[c.weather_code] || '未知';
      weatherTemp = Math.round(c.temperature_2m);
      $('#wm-weather-preview').textContent = `${weatherDesc} ${weatherTemp}°C`;
    }
  } catch {}
  // 如果失败，保持之前的值
}

// ====== 标题编辑 ======
btnTitle.addEventListener('click', () => {
  titleInput.value = wmTitle;
  titleEdit.classList.remove('hidden');
  titleInput.focus();
});

titleSave.addEventListener('click', () => {
  wmTitle = titleInput.value.trim() || '工程记录';
  localStorage.setItem('wm_title', wmTitle);
  $('#wm-title-preview').textContent = wmTitle;
  titleEdit.classList.add('hidden');
});

// 点遮罩空白关闭
titleEdit.addEventListener('click', (e) => {
  if (e.target === titleEdit) titleEdit.classList.add('hidden');
});

// ====== 拍照 ======
btnCapture.addEventListener('click', () => {
  if (!stream) return;
  if (!gpsReady) {
    showToast('请等待GPS定位完成');
    return;
  }

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
  if (facingMode === 'user') rctx.setTransform(1, 0, 0, 1, 0, 0);

  drawWatermark(rctx, vw, vh);

  // 闪光
  const flash = document.createElement('div');
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);
  flash.addEventListener('animationend', () => flash.remove());

  cameraPage.classList.remove('active');
  resultPage.classList.add('active');
  fitCanvas();
});

// ====== 水印绘制 ======
function drawWatermark(ctx, w, h) {
  const title = wmTitle;
  const timeStr = `拍摄时间: ${nowTimeStr()}`;
  const weatherStr = weatherTemp != null
    ? `天气: ${weatherDesc} ${weatherTemp}°C`
    : `天气: ${weatherDesc}`;
  const locStr = `地点: ${locAddress || '定位中...'}`;

  const lines = [title, timeStr, weatherStr, locStr];

  // 自适应字号
  const base = Math.max(20, Math.round(w / 36));
  const fsTitle = Math.min(base * 1.15, 60);
  const fsRow = Math.min(base * 0.78, 42);
  const lh = Math.round(fsRow * 1.65);
  const px = Math.round(fsRow * 1.1);
  const py = Math.round(fsRow * 0.65);
  const margin = Math.round(w * 0.035);

  // 测量最大宽度
  ctx.font = `bold ${fsTitle}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  let maxW = ctx.measureText(title).width;
  ctx.font = `${fsRow}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  for (let i = 1; i < lines.length; i++) {
    const tw = ctx.measureText(lines[i]).width;
    if (tw > maxW) maxW = tw;
  }

  const bw = maxW + px * 2;
  const bh = fsTitle + lh * 3 + py * 2;
  const bx = margin;
  const by = h - margin - bh;

  // 半透明黑底
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, bx, by, bw, bh, Math.round(fsRow * 0.38));
  ctx.fill();

  // 左侧竖线
  const lx = bx + Math.round(fsRow * 0.25);
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillRect(lx, by + Math.round(bh * 0.08), Math.round(fsRow * 0.07), Math.round(bh * 0.84));

  // 标题
  const tx = lx + Math.round(fsRow * 0.5);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${fsTitle}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, tx, by + py);

  // 各行
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = `${fsRow}px -apple-system, "HarmonyOS Sans", "PingFang SC", sans-serif`;
  for (let i = 1; i < lines.length; i++) {
    ctx.fillText(lines[i], tx, by + py + fsTitle + lh * (i - 1));
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.arcTo(x+w, y, x+w, y+r, r);
  ctx.lineTo(x+w, y+h-r);
  ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
  ctx.lineTo(x+r, y+h);
  ctx.arcTo(x, y+h, x, y+h-r, r);
  ctx.lineTo(x, y+r);
  ctx.arcTo(x, y, x+r, y, r);
  ctx.closePath();
}

// ====== 适配画布 ======
function fitCanvas() {
  const mw = resultWrap.clientWidth - 32;
  const mh = resultWrap.clientHeight - 64;
  const r = Math.min(mw / resultCanvas.width, mh / resultCanvas.height);
  resultCanvas.style.width = resultCanvas.width * r + 'px';
  resultCanvas.style.height = resultCanvas.height * r + 'px';
}

window.addEventListener('resize', () => {
  if (resultPage.classList.contains('active')) fitCanvas();
});

// ====== 重拍 / 保存 ======
btnRetake.addEventListener('click', () => {
  resultPage.classList.remove('active');
  cameraPage.classList.add('active');
});

btnSave.addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = `watermark_${Date.now()}.jpg`;
  a.href = resultCanvas.toDataURL('image/jpeg', 0.94);
  a.click();
  showToast('已保存到相册');
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

init();
