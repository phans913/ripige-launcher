# 대장장이 런처

Minecraft 1.20.1 Forge 기반의 대장장이 서버 전용 Windows 런처입니다.

- 서버: `phans.p-e.kr:25565`
- Forge: `47.4.10`
- 관리 모드: Armourer's Workshop `2.1.4`
- 원격 배포 매니페스트: `blacksmith` 브랜치의 `distribution.json`

## 개발

```powershell
pnpm install
pnpm test
pnpm lint
pnpm run dist:win
```

## 게임 릴리스 자산 생성

Forge 설치 경로와 모드 경로는 소스에 고정하지 않고 명령 인자로 전달합니다. 지정한 Minecraft 설치에는 `forge-47.4.10` 프로필과 해당 프로필이 사용하는 모든 런타임 라이브러리가 준비되어 있어야 합니다.

```powershell
pnpm run build:release -- `
  --minecraft-install "C:\path\to\minecraft\Install" `
  --forge-profile "forge-47.4.10" `
  --mod "C:\path\to\armourersworkshop-forge-1.20.1-2.1.4.jar" `
  --version "1.0.0"

pnpm run verify:release
```

생성 결과는 `release/`에 저장됩니다. `distribution.json`은 `blacksmith` 브랜치에 커밋하고 나머지 자산은 `blacksmith-v1.0.0` 릴리스에 함께 게시합니다.

## 브랜딩

아이콘, 배경, 폰트와 화면 레이아웃은 리피지 런처의 자산을 그대로 사용합니다. `pnpm run generate:icons`는 새 원본으로 아이콘을 교체할 때만 사용합니다.
