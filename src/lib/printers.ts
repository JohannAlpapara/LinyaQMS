import { promisify } from 'util'
import { exec as execCallback } from 'child_process'

const execAsync = promisify(execCallback)

export interface PrinterStatus {
  connected: boolean
  platform: NodeJS.Platform
  printers: string[]
  readyPrinters: string[]
  defaultPrinter: string | null
  details: string
}

interface DetectedPrinter {
  name: string
  isOnline: boolean
  statusText: string
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

const POSIX_UNAVAILABLE_PATTERN = /(offline|disabled|not connected|unable to connect|unreachable|timed out|stopped|paused|media-empty|out of paper|cover open|door open|jam)/i

function normalizeStatusText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function parsePosixPrinterStates(output: string): DetectedPrinter[] {
  return output
    .split(/\n(?=printer\s+)/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('printer '))
    .map((block) => {
      const statusText = normalizeStatusText(block)
      const nameMatch =
        statusText.match(/^printer\s+(.+?)(?=\s+(?:is|now)\s+)/i) ??
        statusText.match(/^printer\s+([^\s]+)/i)
      const name = nameMatch?.[1]?.trim()

      if (!name) {
        return null
      }

      return {
        name,
        isOnline: !POSIX_UNAVAILABLE_PATTERN.test(statusText),
        statusText,
      }
    })
    .filter((printer): printer is DetectedPrinter => Boolean(printer))
}

function parseMacPrinterStates(output: string): DetectedPrinter[] {
  const printers: DetectedPrinter[] = []
  let currentName: string | null = null
  let currentStatus = ''

  const flushCurrent = () => {
    if (!currentName) {
      return
    }

    const statusText = normalizeStatusText(currentStatus || 'Status unknown')
    printers.push({
      name: currentName,
      isOnline: !POSIX_UNAVAILABLE_PATTERN.test(statusText),
      statusText,
    })
  }

  for (const line of output.split('\n')) {
    const nameMatch = line.match(/^\s{4}(.+):\s*$/)
    if (nameMatch && nameMatch[1] !== 'Printers') {
      flushCurrent()
      currentName = nameMatch[1].trim()
      currentStatus = ''
      continue
    }

    const statusMatch = line.match(/^\s{6}Status:\s*(.+)$/)
    if (statusMatch) {
      currentStatus = statusMatch[1].trim()
    }
  }

  flushCurrent()
  return printers
}

function buildPrinterDetails(printers: DetectedPrinter[], source: string): string {
  if (printers.length === 0) {
    return `No printers detected via ${source}`
  }

  const readyPrinters = printers.filter((printer) => printer.isOnline)
  const unavailablePrinters = printers.filter((printer) => !printer.isOnline)

  if (unavailablePrinters.length === 0) {
    return `Found ${printers.length} ready printer(s)`
  }

  const unavailableSummary = unavailablePrinters
    .map((printer) => `${printer.name}: ${printer.statusText}`)
    .join('; ')

  if (readyPrinters.length === 0) {
    return `Found ${printers.length} printer(s), but all are unavailable (${unavailableSummary})`
  }

  return `Found ${printers.length} printer(s); ${readyPrinters.length} ready, ${unavailablePrinters.length} unavailable (${unavailableSummary})`
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

async function getPosixPrinters(): Promise<{ printers: string[]; readyPrinters: string[]; defaultPrinter: string | null; details: string }> {
  const list = await run('lpstat -p -l')
  let printerStates = list.ok ? parsePosixPrinterStates(list.stdout) : []

  const def = await run('lpstat -d')
  const match = def.ok ? def.stdout.match(/destination:\s*(.+)$/i) : null
  let defaultPrinter = match?.[1]?.trim() || null
  let details = list.ok
    ? buildPrinterDetails(printerStates, 'lpstat')
    : 'Unable to query printers via lpstat'

  // macOS fallback when CUPS CLI tools are unavailable
  if (process.platform === 'darwin' && printerStates.length === 0) {
    const profiler = await run('system_profiler SPPrintersDataType')
    if (profiler.ok) {
      printerStates = parseMacPrinterStates(profiler.stdout)
      details = buildPrinterDetails(printerStates, 'system_profiler')
    }
  }

  const printers = printerStates.map((printer) => printer.name)
  const readyPrinters = printerStates.filter((printer) => printer.isOnline).map((printer) => printer.name)
  defaultPrinter = defaultPrinter || readyPrinters[0] || printers[0] || null

  return { printers, readyPrinters, defaultPrinter, details }
}

export async function getPrinterStatus(): Promise<PrinterStatus> {
  const platform = process.platform

  if (platform === 'win32') {
    const { printers, defaultPrinter, details } = await getWindowsPrinters()
    return {
      connected: printers.length > 0,
      platform,
      printers,
      readyPrinters: printers,
      defaultPrinter,
      details,
    }
  }

  if (platform === 'darwin' || platform === 'linux') {
    const { printers, readyPrinters, defaultPrinter, details } = await getPosixPrinters()
    const canPrint = (await hasCommand('lp')) || (await hasCommand('lpr'))
    return {
      connected: readyPrinters.length > 0 && canPrint,
      platform,
      printers,
      readyPrinters,
      defaultPrinter,
      details: canPrint ? details : `${details}; print command unavailable (lp/lpr)`,
    }
  }

  return {
    connected: false,
    platform,
    printers: [],
    readyPrinters: [],
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
    return { success: false, details: status.details || 'No printer is ready on the host machine' }
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
      const printer = status.readyPrinters[0] || status.defaultPrinter || status.printers[0]

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
