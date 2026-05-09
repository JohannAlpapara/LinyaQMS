export interface CompactTicketOptions {
  queueNumber: string
  laneName: string
  timestamp: string
}

export function buildCompactTicketText({ queueNumber, laneName, timestamp }: CompactTicketOptions): string {
  return [
    `SERVICE ${laneName}`,
    `TIME    ${timestamp}`,
    '',
    queueNumber,
    '',
  ].join('\n')
}

export function buildCompactTicketEscPos({ queueNumber, laneName, timestamp }: CompactTicketOptions): Buffer {
  const chunks: number[] = []
  const write = (value: string) => chunks.push(...Buffer.from(value, 'ascii'))
  const cmd = (...bytes: number[]) => chunks.push(...bytes)

  cmd(0x1b, 0x40)
  cmd(0x1b, 0x61, 0x00)
  cmd(0x1b, 0x45, 0x01)
  write(`SERVICE ${laneName}\n`)
  cmd(0x1b, 0x45, 0x00)
  write(`TIME    ${timestamp}\n\n`)

  cmd(0x1b, 0x61, 0x01)
  cmd(0x1b, 0x45, 0x01)
  cmd(0x1d, 0x21, 0x22)
  write(`${queueNumber}\n`)
  cmd(0x1d, 0x21, 0x00)
  cmd(0x1b, 0x45, 0x00)

  write('\n\n')
  cmd(0x1d, 0x56, 0x00)

  return Buffer.from(chunks)
}