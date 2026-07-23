$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$customSource = Join-Path $projectRoot 'branding-icon-source.png'
$backgroundSource = Join-Path $projectRoot 'branding-background.png'
$sourcePath = if (Test-Path -LiteralPath $customSource) { $customSource } else { $backgroundSource }

Add-Type -AssemblyName System.Drawing

function New-SquarePng {
    param(
        [System.Drawing.Image]$Source,
        [int]$Size,
        [string]$OutputPath
    )

    $cropSize = [Math]::Min($Source.Width, $Source.Height)
    $cropX = [int](($Source.Width - $cropSize) / 2)
    $cropY = [int](($Source.Height - $cropSize) / 2)
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $sourceRect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)
        $targetRect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
        $graphics.DrawImage($Source, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
        $outputDirectory = Split-Path -Parent $OutputPath
        [System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Convert-PngToIco {
    param(
        [string]$PngPath,
        [string]$IcoPath
    )

    $pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
    $stream = New-Object System.IO.MemoryStream
    $writer = New-Object System.IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]1)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$pngBytes.Length)
        $writer.Write([uint32]22)
        $writer.Write($pngBytes)
        [System.IO.File]::WriteAllBytes($IcoPath, $stream.ToArray())
    } finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
try {
    $uiIcon = Join-Path $projectRoot 'app\assets\images\icon.png'
    $buildIcon = Join-Path $projectRoot 'build\icon.png'
    $icoSource = Join-Path $projectRoot 'build\icon-256.png'
    New-SquarePng -Source $sourceImage -Size 512 -OutputPath $uiIcon
    New-SquarePng -Source $sourceImage -Size 512 -OutputPath $buildIcon
    New-SquarePng -Source $sourceImage -Size 256 -OutputPath $icoSource

    $buildIco = Join-Path $projectRoot 'build\icon.ico'
    $appIco = Join-Path $projectRoot 'app\assets\images\icon.ico'
    Convert-PngToIco -PngPath $icoSource -IcoPath $buildIco
    [System.IO.File]::Copy($buildIco, $appIco, $true)
} finally {
    $sourceImage.Dispose()
}

Write-Output "Generated temporary launcher icons from $sourcePath"
