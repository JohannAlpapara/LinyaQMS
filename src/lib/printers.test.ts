import assert from 'node:assert/strict'
import test from 'node:test'

import { parsePosixPrinterStates } from './printers'

test('marks an offline POSIX printer as unavailable', () => {
  const printers = parsePosixPrinterStates(`printer YICHIP_POS58_Printer now printing YICHIP_POS58_Printer-36.  enabled since Sat Apr  4 23:14:39 2026
        The printer is offline.
`)

  assert.deepEqual(printers, [
    {
      name: 'YICHIP_POS58_Printer',
      isOnline: false,
      statusText: 'printer YICHIP_POS58_Printer now printing YICHIP_POS58_Printer-36. enabled since Sat Apr 4 23:14:39 2026 The printer is offline.',
    },
  ])
})

test('marks an idle POSIX printer as available', () => {
  const printers = parsePosixPrinterStates(`printer Receipt_Printer is idle. enabled since Sat Apr  4 23:14:39 2026
`)

  assert.deepEqual(printers, [
    {
      name: 'Receipt_Printer',
      isOnline: true,
      statusText: 'printer Receipt_Printer is idle. enabled since Sat Apr 4 23:14:39 2026',
    },
  ])
})
