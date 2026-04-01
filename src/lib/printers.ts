import { promisify } from 'util'
import { exec as execCallback } from 'child_process'

const execAsync = promisify(execCallback)

export interface PrinterStatus {
  connected: boolean
  platform: NodeJS.Platform
  printers: string[]
  defaultPrinter: string | null
  details: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function run(command: string) {
  try {
    const { stdout, stderr } = await execAsync(command)
    return { ok: true, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, stdout: '', stderr: message }
  }
}

async function hasCommand(command: string): Promise<boolean> {
  const check = await run(`command -v ${command}`)
  return check.ok && Boolean(check.stdout.trim())
}

function parsePosixPrinters(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('printer '))
    .map((line) => line.replace(/^printer\s+/, '').split(' ')[0])
    .filter(Boolean)
}

function parseMacPrinters(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('Display Name:'))
    .map((line) => line.replace('Display Name:', '').trim())
    .filter(Boolean)
}

function parseWindowsPrinters(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.toLowerCase().includes('name') && !line.startsWith('---'))
}

async function getWindowsPrinters(): Promise<{ printers: string[]; defaultPrinter: string | null; details: string }> {
  const list = await run('powershell -NoProfile -Command "Get-Printer | Select-Object -ExpandProperty Name"')
  const printers = list.ok ? parseWindowsPrinters(list.stdout) : []

  const def = await run('powershell -NoProfile -Command "(Get-CimInstance Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object -ExpandProperty Name)"')
  const defaultPrinter = def.ok ? def.stdout.trim() || null : null

  const details = list.ok
    ? `Found ${printers.length} printer(s)`
    : 'Unable to query printers via PowerShell'

  return { printers, defaultPrinter, details }
}

async function getPosixPrinters(): Promise<{ printers: string[]; defaultPrinter: string | null; details: string }> {
  const list = await run('lpstat -p')
  let printers = list.ok ? parsePosixPrinters(list.stdout) : []

  const def = await run('lpstat -d')
  const match = def.ok ? def.stdout.match(/destination:\s*(.+)$/i) : null
  let defaultPrinter = match?.[1]?.trim() || null
  let details = list.ok
    ? `Found ${printers.length} printer(s)`
    : 'Unable to query printers via lpstat'

  // macOS fallback when CUPS CLI tools are unavailable
  if (process.platform === 'darwin' && printers.length === 0) {
    const profiler = await run('system_profiler SPPrintersDataType')
    if (profiler.ok) {
      printers = parseMacPrinters(profiler.stdout)
      defaultPrinter = defaultPrinter || printers[0] || null
      details = `Found ${printers.length} printer(s) via system_profiler`
    }
  }

  return { printers, defaultPrinter, details }
}

export async function getPrinterStatus(): Promise<PrinterStatus> {
  const platform = process.platform

  if (platform === 'win32') {
    const { printers, defaultPrinter, details } = await getWindowsPrinters()
    return {
      connected: printers.length > 0,
      platform,
      printers,
      defaultPrinter,
      details,
    }
  }

  if (platform === 'darwin' || platform === 'linux') {
    const { printers, defaultPrinter, details } = await getPosixPrinters()
    const canPrint = (await hasCommand('lp')) || (await hasCommand('lpr'))
    return {
      connected: printers.length > 0 && canPrint,
      platform,
      printers,
      defaultPrinter,
      details: canPrint ? details : `${details}; print command unavailable (lp/lpr)`,
    }
  }

  return {
    connected: false,
    platform,
    printers: [],
    defaultPrinter: null,
    details: `Unsupported platform: ${platform}`,
  }
}

export async function printTicketText(content: string): Promise<{ success: boolean; details: string }> {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')

  const status = await getPrinterStatus()
  if (!status.connected) {
    return { success: false, details: 'No printer detected on host machine' }
  }

  const filePath = path.join(os.tmpdir(), `linya-ticket-${Date.now()}.txt`)
  fs.writeFileSync(filePath, content, 'utf8')

  try {
    if (process.platform === 'win32') {
      const printed = await run(`cmd /c notepad /p "${filePath}"`)
      if (!printed.ok) {
        return { success: false, details: printed.stderr || 'Windows print command failed' }
      }
      return { success: true, details: `Sent to default printer${status.defaultPrinter ? `: ${status.defaultPrinter}` : ''}` }
    }

    if (process.platform === 'darwin' || process.platform === 'linux') {
      const printer = status.defaultPrinter || status.printers[0]

      const lpAvailable = await hasCommand('lp')
      const lprAvailable = await hasCommand('lpr')
      if (!lpAvailable && !lprAvailable) {
        return { success: false, details: 'No print command available (lp/lpr)' }
      }

      const quotedFile = shellQuote(filePath)
      const quotedPrinter = printer ? shellQuote(printer) : ''
      const attempts: string[] = []

      if (lpAvailable) {
        attempts.push(`lp ${quotedFile}`)
        if (printer) attempts.push(`lp -d ${quotedPrinter} ${quotedFile}`)
      }
      if (lprAvailable) {
        attempts.push(`lpr ${quotedFile}`)
        if (printer) attempts.push(`lpr -P ${quotedPrinter} ${quotedFile}`)
      }

      let lastError = 'POSIX print command failed'
      let printedOk = false
      for (const command of attempts) {
        const printed = await run(command)
        if (printed.ok) {
          printedOk = true
          break
        }
        lastError = printed.stderr || lastError
      }

      if (!printedOk) {
        return { success: false, details: lastError }
      }

      return { success: true, details: `Sent to printer: ${printer}` }
    }

    return { success: false, details: `Unsupported platform: ${process.platform}` }
  } finally {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // temp file cleanup is best-effort
    }
  }
}
