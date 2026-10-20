// KCCP 출석 데스크톱 앱.
//
// 웹과 "똑같이" 동작하는 가장 확실한 방법은 웹을 그대로 여는 것이다: 이 창은 운영 사이트
// (https://shrlak.github.io/kccp-attendance/)를 불러온다. 같은 코드 · 같은 엣지 함수 · 같은
// DB를 쓰므로 기능·연동·구글 로그인이 웹과 한 글자도 다르지 않고, 웹이 배포되면 앱도 다음
// 실행에서 바로 따라온다 (앱을 다시 설치할 일이 없다).
const { app, BrowserWindow, Menu, shell, session } = require('electron')
const path = require('path')

const SITE = process.env.KCCP_URL || 'https://shrlak.github.io/kccp-attendance/'
const SITE_ORIGIN = new URL(SITE).origin

// 앱 안에서 열려야 하는 곳: 사이트 자신 + 구글/Supabase 로그인 경유지.
const INTERNAL_HOSTS = [/(^|\.)github\.io$/, /(^|\.)supabase\.co$/, /(^|\.)google\.com$/, /(^|\.)gstatic\.com$/]
const isInternal = (u) => {
  try {
    const { protocol, hostname } = new URL(u)
    return protocol === 'https:' && INTERNAL_HOSTS.some((re) => re.test(hostname))
  } catch {
    return false
  }
}

// 구글은 UA에 "Electron"이 있으면 OAuth를 막는다(disallowed_useragent). 일반 크롬으로 보이게 한다.
const cleanUA = (ua) => ua.replace(/\sElectron\/\S+/, '').replace(new RegExp(`\\s${app.getName()}/\\S+`), '')

let win
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 360,
    minHeight: 560,
    title: 'KCCP 출석',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.webContents.setUserAgent(cleanUA(win.webContents.getUserAgent()))

  // 카메라(카드 사진)·위치(로그인 위치 기록)는 우리 사이트에서만 허용한다.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = ['media', 'geolocation', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)
    cb(ok && wc.getURL().startsWith(SITE_ORIGIN))
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })

  const offline = () => win.loadFile(path.join(__dirname, 'offline.html'))
  win.webContents.on('did-fail-load', (_e, code, _d, url, isMain) => {
    if (isMain && code !== -3 && url.startsWith(SITE_ORIGIN)) offline()
  })
  win.loadURL(SITE)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      {
        label: '보기',
        submenu: [
          { label: '새로고침', accelerator: 'CmdOrCtrl+R', click: () => win?.webContents.reload() },
          { label: '처음 화면으로', click: () => win?.loadURL(SITE) },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
      { role: 'windowMenu' },
    ]),
  )
}

const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
