# 리피지 런처

Minecraft 1.20.1 Fabric 기반의 리피지 서버 전용 Windows 런처입니다.

- 서버: `phans.p-e.kr:24454`
- Fabric Loader: `0.19.3`
- 관리 모드: Fabric API `0.92.11`, Iris `1.7.6`, Sodium `0.5.13`
- 관리 리소스팩: `ROW-1.20.1-Unpacked-Original`

## 개발

```powershell
pnpm install
pnpm test
pnpm lint
pnpm run dist:win
```

## 게임 파일 번들 생성

로컬 경로는 소스에 고정하지 않고 명령 인자로 전달합니다.

```powershell
pnpm run build:bundle -- `
  --instance "C:\path\to\minecraft\instance" `
  --minecraft-install "C:\path\to\minecraft\Install" `
  --version "1.0.0"
```

생성 결과는 `release/`에 저장됩니다. GitHub의 각 최신 릴리스에는 생성된 모든 자산을 함께 올려야 합니다.

## 아이콘 교체

`branding-background.png` 대신 사용할 정식 정사각형 원본을 `branding-icon-source.png`로 저장하고 아래 명령을 실행하면 런처용 PNG/ICO가 다시 만들어집니다.

```powershell
pnpm run generate:icons
```

현재 1.0.0은 제공된 런처 배경 이미지의 중앙 크롭을 임시 아이콘으로 사용합니다.

