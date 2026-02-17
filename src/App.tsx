import { useState, useCallback } from 'react'
import { jsPDF } from 'jspdf'
import { useAuth } from './contexts/AuthContext'
import Login from './Login'
import './App.css'

const MAX_LINES = 10

const CARRIER_OPTIONS = [
  { value: '', label: 'Select carrier...' },
  { value: 'AT&T', label: 'AT&T' },
  { value: 'Consumer Cellular', label: 'Consumer Cellular' },
  { value: 'Cricket', label: 'Cricket' },
  { value: 'Other', label: 'Other' },
  { value: 'Spectrum', label: 'Spectrum' },
  { value: 'T Mobile', label: 'T Mobile' },
  { value: 'Verizon', label: 'Verizon' },
] as const

const ATT_PLAN_OPTIONS = [
  { value: '', label: 'Select plan...' },
  { value: 'FirstNet', label: 'FirstNet' },
  { value: 'Premium', label: 'Premium' },
  { value: 'Extra', label: 'Extra' },
  { value: 'Starter', label: 'Starter' },
  { value: 'Value Plus', label: 'Value Plus' },
  { value: 'Legacy', label: 'Legacy' },
] as const

const DATA_DEVICE_OPTIONS = [
  { value: '', label: 'Select type...' },
  { value: 'Wearable', label: 'Wearable' },
  { value: 'Tablet', label: 'Tablet' },
] as const

/** Options for "suggest replace with" when carrier is not AT&T (does not affect pricing) */
const SUGGESTED_REPLACEMENT_OPTIONS = [
  { value: '', label: 'No suggestion' },
  { value: 'FirstNet', label: 'FirstNet' },
  { value: 'Premium', label: 'Premium' },
  { value: 'Extra', label: 'Extra' },
  { value: 'Starter', label: 'Starter' },
  { value: 'Value Plus', label: 'Value Plus' },
  { value: 'Legacy', label: 'Legacy' },
] as const

/** AT&T monthly price for data device types (wearable, tablet) */
const ATT_DATA_DEVICE_PRICES: Record<string, number> = {
  Wearable: 10,
  Tablet: 20,
}

/** Per-line monthly price by AT&T plan (single-line; used when selecting a plan) */
const ATT_PLAN_PRICES: Record<string, number> = {
  FirstNet: 42.99,
  Premium: 85.99,
  Extra: 75.99,
  Starter: 65.99,
  'Value Plus': 50.99,
  Legacy: 55.0, // legacy plans vary; placeholder
}

/** Per-line price by AT&T plan and number of lines (multi-line discount). Index 0 = 1 line, 1 = 2 lines, etc. Use index 3 for 4+ lines. */
const ATT_MULTILINE_PRICES: Record<string, number[]> = {
  FirstNet: [42.99, 42.99, 42.99, 42.99],
  Premium: [85.99, 75.99, 60.99, 50.99],
  Extra: [75.99, 65.99, 50.99, 40.99],
  Starter: [65.99, 60.99, 45.99, 35.99],
  'Value Plus': [50.99, 50.99, 37.99, 30.99],
  Legacy: [55, 55, 55, 55],
}

function getAttMultiLinePrice(plan: string, lineCount: number): number {
  if (!lineCount || !plan) return 0
  const tiers = ATT_MULTILINE_PRICES[plan]
  if (!tiers) return ATT_PLAN_PRICES[plan] ?? 0
  const index = Math.min(lineCount - 1, 3) // 1→0, 2→1, 3→2, 4+→3
  return tiers[index] ?? tiers[0]
}

/** Apply 25% discount to non-FirstNet lines when account has at least one FirstNet line */
function applyFirstNetFamilyDiscount(
  lines: PhoneLine[],
  basePrice: number,
  lineLabel: string
): number {
  const hasFirstNet = lines.some((l) => l.label === 'FirstNet')
  if (lineLabel !== 'FirstNet' && hasFirstNet) {
    return Math.round(basePrice * 0.75 * 100) / 100
  }
  return basePrice
}

/** Apply FirstNet family discount, then optional 25% discount when account is 25% discount eligible */
function applyLinePriceDiscounts(
  lines: PhoneLine[],
  basePrice: number,
  lineLabel: string,
  discount25Eligible: boolean
): number {
  let price = applyFirstNetFamilyDiscount(lines, basePrice, lineLabel)
  if (discount25Eligible) {
    price = Math.round(price * 0.75 * 100) / 100
  }
  return price
}

export interface PhoneLine {
  id: string
  customerName: string
  label: string
  pricePerMonth: number
  hotspot?: boolean
  dataDevice?: boolean
  /** Rep suggestion for replacing this line (when carrier is not AT&T); does not affect pricing */
  suggestedReplacement?: string
  /** Add-ons when carrier is not AT&T */
  addOnPro1?: boolean
  addOnPro4?: boolean
  addOnHtp?: boolean
  addOnTurbo?: boolean
}

export interface BillInfo {
  carrier: string
  accountHolderName: string
  accountHolderPhone: string
  accountHolderEmployerOrTitle: string
  accountHolderEmail: string
  accountHolderAddress: string
  aiaEligibility: boolean
  discount25Eligible: boolean
  senior55: boolean
  kickerUnlocked: boolean
  internetAir: boolean
  salesRepName: string
  salesRepNotes: string
  lines: PhoneLine[]
}

export interface ExportLineOutcome {
  sold: boolean
  objections: string
}

export type AddOnLabel = 'Pro 1' | 'Pro 4' | 'HTP' | 'Turbo'

export interface ExportAddOnOutcome {
  lineIndex: number
  addOn: AddOnLabel
  sold: boolean
  objections: string
}

function getPitchedAddOns(bill: BillInfo): { lineIndex: number; addOn: AddOnLabel }[] {
  const result: { lineIndex: number; addOn: AddOnLabel }[] = []
  bill.lines.forEach((line, i) => {
    if (line.addOnPro1) result.push({ lineIndex: i, addOn: 'Pro 1' })
    if (line.addOnPro4) result.push({ lineIndex: i, addOn: 'Pro 4' })
    if (line.addOnHtp) result.push({ lineIndex: i, addOn: 'HTP' })
    if (line.addOnTurbo) result.push({ lineIndex: i, addOn: 'Turbo' })
  })
  return result
}

function generateId() {
  return Math.random().toString(36).slice(2, 11)
}

const defaultLine = (): PhoneLine => ({
  id: generateId(),
  customerName: '',
  label: '',
  pricePerMonth: 0,
  hotspot: false,
  dataDevice: false,
  suggestedReplacement: '',
  addOnPro1: false,
  addOnPro4: false,
  addOnHtp: false,
  addOnTurbo: false,
})

const initialBill: BillInfo = {
  carrier: '',
  accountHolderName: '',
  accountHolderPhone: '',
  accountHolderEmployerOrTitle: '',
  accountHolderEmail: '',
  accountHolderAddress: '',
  aiaEligibility: false,
  discount25Eligible: false,
  senior55: false,
  kickerUnlocked: false,
  internetAir: false,
  salesRepName: '',
  salesRepNotes: '',
  lines: [defaultLine()],
}

function formatCurrency(value: number): string {
  if (Number.isNaN(value) || value === 0) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function exportToPdf(
  bill: BillInfo,
  totalPerMonth: number,
  addOnePremiumIncrease?: number,
  addOneExtraIncrease?: number,
  lineOutcomes?: ExportLineOutcome[],
  internetOutcome?: ExportLineOutcome,
  addOnOutcomes?: ExportAddOnOutcome[]
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const margin = 18
  let y = margin
  const lineHeight = 6
  const sectionGap = 4

  const addText = (text: string, fontSize = 10) => {
    doc.setFontSize(fontSize)
    doc.text(text, margin, y)
    y += lineHeight
  }
  const addSectionTitle = (title: string) => {
    y += sectionGap
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(title, margin, y)
    y += lineHeight + 2
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
  }

  doc.setFontSize(16)
  doc.setFont('helvetica', 'bold')
  doc.text('Rerate Assistant – Summary', margin, y)
  y += lineHeight + 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y)
  y += lineHeight
  if (bill.salesRepName.trim()) {
    doc.text(`Sales rep: ${bill.salesRepName.trim()}`, margin, y)
    y += lineHeight
  }
  if (bill.salesRepNotes.trim()) {
    doc.text('Notes:', margin, y)
    y += lineHeight
    const notesLines = doc.splitTextToSize(bill.salesRepNotes.trim(), 180 - margin * 2)
    notesLines.forEach((line: string) => {
      doc.text(line, margin, y)
      y += lineHeight
    })
    y += lineHeight
  }
  y += sectionGap

  addSectionTitle('Account holder')
  addText(bill.accountHolderName || '(not provided)')
  addText(bill.accountHolderPhone || '')
  if (bill.accountHolderEmployerOrTitle.trim()) {
    addText(`Employer / Job title: ${bill.accountHolderEmployerOrTitle.trim()}`)
  }
  addText(bill.accountHolderEmail || '')
  addText(bill.accountHolderAddress || '')

  addSectionTitle('Bill information')
  addText(`Carrier: ${bill.carrier || '(not selected)'}`)
  addText(`AIA Eligible: ${bill.aiaEligibility ? 'Yes' : 'No'}`)
  if (bill.carrier === 'AT&T') {
    addText(`25% Discount Eligible: ${bill.discount25Eligible ? 'Yes' : 'No'}`)
    addText(`55+: ${bill.senior55 ? 'Yes' : 'No'}`)
  }
  addText(`Kicker Unlocked: ${bill.kickerUnlocked ? 'Yes' : 'No'}`)

  addSectionTitle('Phone lines')
  bill.lines.forEach((line, i) => {
    const planOrSuggest = bill.carrier === 'AT&T'
      ? (line.dataDevice ? `${line.label || ''}` : line.label || '')
      : (line.suggestedReplacement ? `Suggest: ${line.suggestedReplacement}` : '')
    const addOns = [line.addOnPro1 && 'Pro 1', line.addOnPro4 && 'Pro 4', line.addOnHtp && 'HTP', line.addOnTurbo && 'Turbo'].filter(Boolean).join(', ') || '—'
    addText(`Line ${i + 1}: ${line.customerName || '—'} | ${planOrSuggest || '—'} | Add-ons: ${addOns} | ${formatCurrency(Number(line.pricePerMonth) || 0)}/mo`)
  })
  y += 2
  addText(`Estimated monthly total (lines): ${formatCurrency(totalPerMonth)}`)
  addText('All prices are shown before taxes.')

  if (lineOutcomes && lineOutcomes.length === bill.lines.length) {
    addSectionTitle('Line outcomes (did you sell each line?)')
    lineOutcomes.forEach((outcome, i) => {
      const line = bill.lines[i]
      const lineDesc = `Line ${i + 1}: ${line?.customerName || '—'}`
      addText(`${lineDesc} – ${outcome.sold ? 'Sold' : 'Not sold'}`)
      if (!outcome.sold && outcome.objections.trim()) {
        const objectionLines = doc.splitTextToSize(`Objections: ${outcome.objections.trim()}`, 180 - margin * 2)
        objectionLines.forEach((lineText: string) => {
          doc.text(lineText, margin, y)
          y += lineHeight
        })
      }
    })
    if (internetOutcome != null) {
      addText(`High Speed Internet – ${internetOutcome.sold ? 'Sold' : 'Not sold'}`)
      if (!internetOutcome.sold && internetOutcome.objections.trim()) {
        const objectionLines = doc.splitTextToSize(`Objections: ${internetOutcome.objections.trim()}`, 180 - margin * 2)
        objectionLines.forEach((lineText: string) => {
          doc.text(lineText, margin, y)
          y += lineHeight
        })
      }
    }
    if (addOnOutcomes && addOnOutcomes.length > 0) {
      addSectionTitle('Add-on outcomes (did you sell each add-on?)')
      addOnOutcomes.forEach((outcome) => {
        const line = bill.lines[outcome.lineIndex]
        const lineDesc = `Line ${outcome.lineIndex + 1}: ${line?.customerName || '—'} – ${outcome.addOn}`
        addText(`${lineDesc} – ${outcome.sold ? 'Sold' : 'Not sold'}`)
        if (!outcome.sold && outcome.objections.trim()) {
          const objectionLines = doc.splitTextToSize(`Objections: ${outcome.objections.trim()}`, 180 - margin * 2)
          objectionLines.forEach((lineText: string) => {
            doc.text(lineText, margin, y)
            y += lineHeight
          })
        }
      })
    }
    y += sectionGap
  }

  addSectionTitle('Opportunities / Commission')
  addText(`Estimated total: ${formatCurrency(totalPerMonth)}`)
  if (bill.carrier === 'AT&T') {
    if (addOnePremiumIncrease != null) addText(`Add one more line (Premium): +${formatCurrency(addOnePremiumIncrease)}/mo – Commission: $${bill.kickerUnlocked ? 30 : 15}`)
    if (addOneExtraIncrease != null) addText(`Add one more line (Extra): +${formatCurrency(addOneExtraIncrease)}/mo – Commission: $${bill.kickerUnlocked ? 20 : 10}`)
    addText(`Add High Speed Internet: +${formatCurrency(bill.aiaEligibility ? 47 : 60)}/mo – Commission: $${bill.kickerUnlocked ? 30 : 15}`)
    const atTotal = (addOnePremiumIncrease != null && addOneExtraIncrease != null) ? (bill.kickerUnlocked ? 80 : 40) : (bill.kickerUnlocked ? 65 : 35)
    addText(`Total potential commission: $${atTotal}`)
  } else if (bill.carrier !== '') {
    const premiumPitched = bill.lines.filter((l) => l.suggestedReplacement === 'Premium').length
    const extraPitched = bill.lines.filter((l) => l.suggestedReplacement === 'Extra').length
    const pro1Count = bill.lines.filter((l) => l.addOnPro1).length
    const pro4Count = bill.lines.filter((l) => l.addOnPro4).length
    const htpCount = bill.lines.filter((l) => l.addOnHtp).length
    const turboCount = bill.lines.filter((l) => l.addOnTurbo).length
    const premiumCommission = bill.kickerUnlocked ? 30 : 15
    const extraCommission = bill.kickerUnlocked ? 20 : 10
    const internetCommission = bill.kickerUnlocked ? 30 : 15
    const totalCommission =
      premiumPitched * premiumCommission +
      extraPitched * extraCommission +
      internetCommission +
      pro1Count * 3 + pro4Count * 5 + htpCount * 5 + turboCount * 2
    if (premiumPitched > 0) addText(`Premium (${premiumPitched}): $${premiumPitched * premiumCommission}`)
    if (extraPitched > 0) addText(`Extra (${extraPitched}): $${extraPitched * extraCommission}`)
    addText(`High Speed Internet: $${internetCommission}`)
    if (pro1Count > 0) addText(`Pro 1 (${pro1Count}): $${pro1Count * 3}`)
    if (pro4Count > 0) addText(`Pro 4 (${pro4Count}): $${pro4Count * 5}`)
    if (htpCount > 0) addText(`HTP (${htpCount}): $${htpCount * 5}`)
    if (turboCount > 0) addText(`Turbo (${turboCount}): $${turboCount * 2}`)
    addText(`Total commission: $${totalCommission}`)
  }

  doc.save(`rerate-assistant-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export default function App() {
  const { session, loading, signOut } = useAuth()
  const [bill, setBill] = useState<BillInfo>(initialBill)
  const [exportFormOpen, setExportFormOpen] = useState(false)

  if (loading) {
    return (
      <div className="app-loading">
        <span>Loading…</span>
      </div>
    )
  }
  if (!session) {
    return <Login />
  }
  const [exportLineOutcomes, setExportLineOutcomes] = useState<ExportLineOutcome[]>([])
  const [exportInternetOutcome, setExportInternetOutcome] = useState<ExportLineOutcome>({ sold: false, objections: '' })
  const [exportAddOnOutcomes, setExportAddOnOutcomes] = useState<ExportAddOnOutcome[]>([])

  const updateBill = useCallback((updates: Partial<BillInfo>) => {
    setBill((prev) => ({ ...prev, ...updates }))
  }, [])

  const updateLine = useCallback((index: number, updates: Partial<PhoneLine>) => {
    setBill((prev) => {
      const next = [...prev.lines]
      next[index] = { ...next[index], ...updates }
      return { ...prev, lines: next }
    })
  }, [])

  const addLine = useCallback(() => {
    if (bill.lines.length >= MAX_LINES) return
    setBill((prev) => {
      const newLines = [...prev.lines, defaultLine()]
      const phoneLineCount = newLines.filter(
        (l) => !l.dataDevice && l.label !== 'FirstNet'
      ).length
      if (prev.carrier === 'AT&T') {
        return {
          ...prev,
          lines: newLines.map((line) => {
            let base: number
            if (line.dataDevice) {
              base = line.label ? ATT_DATA_DEVICE_PRICES[line.label] ?? 0 : 0
            } else {
              base = getAttMultiLinePrice(line.label, phoneLineCount)
              const hotspotAdd =
                line.label === 'FirstNet' && line.hotspot ? 5 : 0
              base += hotspotAdd
            }
            const price = applyLinePriceDiscounts(
              newLines,
              base,
              line.label,
              prev.discount25Eligible
            )
            return { ...line, pricePerMonth: price }
          }),
        }
      }
      return { ...prev, lines: newLines }
    })
  }, [bill.lines.length])

  const removeLine = useCallback((index: number) => {
    if (bill.lines.length <= 1) return
    setBill((prev) => {
      const newLines = prev.lines.filter((_, i) => i !== index)
      const phoneLineCount = newLines.filter(
        (l) => !l.dataDevice && l.label !== 'FirstNet'
      ).length
      if (prev.carrier === 'AT&T') {
        return {
          ...prev,
          lines: newLines.map((line) => {
            let base: number
            if (line.dataDevice) {
              base = line.label ? ATT_DATA_DEVICE_PRICES[line.label] ?? 0 : 0
            } else {
              base = getAttMultiLinePrice(line.label, phoneLineCount)
              const hotspotAdd =
                line.label === 'FirstNet' && line.hotspot ? 5 : 0
              base += hotspotAdd
            }
            const price = applyLinePriceDiscounts(
              newLines,
              base,
              line.label,
              prev.discount25Eligible
            )
            return { ...line, pricePerMonth: price }
          }),
        }
      }
      return { ...prev, lines: newLines }
    })
  }, [bill.lines.length])

  const totalPerMonth = bill.lines.reduce(
    (sum, line) => sum + (Number(line.pricePerMonth) || 0),
    0
  )

  const phoneLineCount = bill.lines.filter(
    (l) => !l.dataDevice && l.label !== 'FirstNet'
  ).length
  const oneMoreLineCount = phoneLineCount + 1

  const existingTotalIfOneMore =
    bill.carrier === 'AT&T'
      ? bill.lines.reduce((sum, line) => {
          let base: number
          if (line.dataDevice) {
            base = line.label ? ATT_DATA_DEVICE_PRICES[line.label] ?? 0 : 0
          } else {
            base = getAttMultiLinePrice(line.label, oneMoreLineCount)
            const hotspotAdd =
              line.label === 'FirstNet' && line.hotspot ? 5 : 0
            base += hotspotAdd
          }
          return (
            sum +
            applyLinePriceDiscounts(bill.lines, base, line.label, bill.discount25Eligible)
          )
        }, 0)
      : 0

  const newLinePremium =
    bill.carrier === 'AT&T'
      ? applyLinePriceDiscounts(
          bill.lines,
          getAttMultiLinePrice('Premium', oneMoreLineCount),
          'Premium',
          bill.discount25Eligible
        )
      : 0
  const newLineExtra =
    bill.carrier === 'AT&T'
      ? applyLinePriceDiscounts(
          bill.lines,
          getAttMultiLinePrice('Extra', oneMoreLineCount),
          'Extra',
          bill.discount25Eligible
        )
      : 0

  const addOnePremiumIncrease =
    bill.carrier === 'AT&T'
      ? Math.round(
          (existingTotalIfOneMore + newLinePremium - totalPerMonth) * 100
        ) / 100
      : 0
  const addOneExtraIncrease =
    bill.carrier === 'AT&T'
      ? Math.round(
          (existingTotalIfOneMore + newLineExtra - totalPerMonth) * 100
        ) / 100
      : 0

  const isResellerCarrier =
    bill.carrier === 'Cricket' || bill.carrier === 'Consumer Cellular'

  const resellerMessage =
    "This customer's current carrier is a reseller! When porting the numbers over to AT&T service you must do as as a 'Bring-Your-Own-Device' port, then upgrade the devices after the line is successfully ported over!"

  return (
    <div className="app-layout">
      <aside className="app-left" aria-label="Sales rep">
        <div className="sales-rep-cell">
          <label htmlFor="salesRepName">Sales rep name</label>
          <input
            id="salesRepName"
            type="text"
            placeholder="Your name"
            value={bill.salesRepName}
            onChange={(e) => updateBill({ salesRepName: e.target.value })}
          />
        </div>
        <div className="sales-rep-notes">
          <label htmlFor="salesRepNotes">Notes</label>
          <textarea
            id="salesRepNotes"
            placeholder="Notes…"
            value={bill.salesRepNotes}
            onChange={(e) => updateBill({ salesRepNotes: e.target.value })}
            rows={4}
          />
        </div>
        <div className="sales-rep-signout">
          <button type="button" className="btn-sign-out" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="app">
      <header className="app-header">
        <h1>Rerate Assistant</h1>
        <p className="tagline">
          Enter the customer’s current cell phone bill and line pricing (up to {MAX_LINES} lines).
        </p>
      </header>

      <main className="app-main">
        <div className="card bill-info-card">
          <h2>Bill information</h2>
          <div className="form-section">
            <label htmlFor="carrier">Carrier</label>
            <select
              id="carrier"
              value={bill.carrier}
              onChange={(e) => updateBill({ carrier: e.target.value })}
            >
              {CARRIER_OPTIONS.map((opt) => (
                <option key={opt.value || 'placeholder'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {isResellerCarrier && (
              <div className="reseller-message" role="alert">
                {resellerMessage}
              </div>
            )}
          </div>
          <fieldset className="account-holder-form">
            <legend>Account Holder Contact Information</legend>
            <div className="form-section">
              <label htmlFor="accountHolderName">Name</label>
              <input
                id="accountHolderName"
                type="text"
                placeholder="Name"
                value={bill.accountHolderName}
                onChange={(e) => updateBill({ accountHolderName: e.target.value })}
              />
            </div>
            <div className="form-row form-row-two">
              <div className="form-section">
                <label htmlFor="accountHolderPhone">Phone Number</label>
                <input
                  id="accountHolderPhone"
                  type="tel"
                  placeholder="Phone Number"
                  value={bill.accountHolderPhone}
                  onChange={(e) => updateBill({ accountHolderPhone: e.target.value })}
                />
              </div>
              <div className="form-section">
                <label htmlFor="accountHolderEmployerOrTitle">Employer or Job Title</label>
                <input
                  id="accountHolderEmployerOrTitle"
                  type="text"
                  placeholder="Employer or job title"
                  value={bill.accountHolderEmployerOrTitle}
                  onChange={(e) => updateBill({ accountHolderEmployerOrTitle: e.target.value })}
                />
              </div>
            </div>
            <div className="form-section">
              <label htmlFor="accountHolderEmail">Email</label>
              <input
                id="accountHolderEmail"
                type="email"
                placeholder="Email"
                value={bill.accountHolderEmail}
                onChange={(e) => updateBill({ accountHolderEmail: e.target.value })}
              />
            </div>
            <div className="form-section">
              <label htmlFor="accountHolderAddress">Address</label>
              <input
                id="accountHolderAddress"
                type="text"
                placeholder="Address"
                value={bill.accountHolderAddress}
                onChange={(e) => updateBill({ accountHolderAddress: e.target.value })}
              />
              <div className="internet-eligibility-row">
                <button
                  type="button"
                  className="btn-internet-eligibility"
                  onClick={() => {
                    // Open first so it's clearly user-initiated (avoids pop-up blockers)
                    window.open('https://www.att.com/internet/', '_blank', 'noopener,noreferrer')
                    const address = bill.accountHolderAddress.trim()
                    if (address) {
                      navigator.clipboard.writeText(address).catch(() => {})
                    }
                  }}
                >
                  Internet Eligibility Check
                </button>
                <label className="checkbox-label aia-eligibility-checkbox">
                  <input
                    type="checkbox"
                    checked={bill.aiaEligibility}
                    onChange={(e) => updateBill({ aiaEligibility: e.target.checked })}
                  />
                  AIA Eligible
                </label>
                {bill.carrier === 'AT&T' && (
                  <>
                    <label className="checkbox-label discount-25-checkbox">
                      <input
                        type="checkbox"
                        checked={bill.discount25Eligible}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setBill((prev) => {
                            const next = { ...prev, discount25Eligible: checked }
                            if (prev.carrier !== 'AT&T') return next
                            const phoneLineCount = next.lines.filter(
                              (l) => !l.dataDevice && l.label !== 'FirstNet'
                            ).length
                            const lines = next.lines.map((line) => {
                              let base: number
                              if (line.dataDevice) {
                                base = line.label ? ATT_DATA_DEVICE_PRICES[line.label] ?? 0 : 0
                              } else {
                                base = getAttMultiLinePrice(line.label, phoneLineCount)
                                const hotspotAdd =
                                  line.label === 'FirstNet' && line.hotspot ? 5 : 0
                                base += hotspotAdd
                              }
                              const price = applyLinePriceDiscounts(
                                next.lines,
                                base,
                                line.label,
                                next.discount25Eligible
                              )
                              return { ...line, pricePerMonth: price }
                            })
                            return { ...next, lines }
                          })
                        }}
                      />
                      25% Discount Eligible
                    </label>
                    <label className="checkbox-label senior-55-checkbox">
                      <input
                        type="checkbox"
                        checked={bill.senior55}
                        onChange={(e) => updateBill({ senior55: e.target.checked })}
                      />
                      55+
                    </label>
                  </>
                )}
              </div>
            </div>
          </fieldset>
        </div>

        <div className="card lines-card">
          <div className="lines-header">
            <h2>Phone lines</h2>
            <div className="lines-header-actions">
              {bill.carrier !== 'AT&T' && bill.carrier !== '' && (
                <label className="checkbox-label lines-internet-air-checkbox">
                  <input
                    type="checkbox"
                    checked={bill.internetAir}
                    onChange={(e) => updateBill({ internetAir: e.target.checked })}
                  />
                  Internet Air
                </label>
              )}
              <button
                type="button"
                className="btn-add-line"
                onClick={addLine}
                disabled={bill.lines.length >= MAX_LINES}
                title={bill.lines.length >= MAX_LINES ? `Maximum ${MAX_LINES} lines` : 'Add line'}
              >
                + Add line
              </button>
            </div>
          </div>
          <p className="lines-hint">
            {bill.lines.length} of {MAX_LINES} lines. Enter the monthly price for each line.
          </p>

          <div className="lines-list" role="list">
            {bill.lines.map((line, index) => (
              <div key={line.id} className="line-row" role="listitem">
                <div className="line-row-number">Line {index + 1}</div>
                <div className="line-row-fields">
                  <div className="line-labels-stack">
                    <div className="line-customer-name-cell">
                      <label htmlFor={`line-customer-${line.id}`} className="sr-only">
                        Customer name
                      </label>
                      <input
                        id={`line-customer-${line.id}`}
                        type="text"
                        placeholder="Customer name"
                        value={line.customerName ?? ''}
                        onChange={(e) =>
                          updateLine(index, { customerName: e.target.value })
                        }
                        className="line-customer-input"
                      />
                    </div>
                    {bill.carrier === 'AT&T' && (
                      <div className="line-plan-cell">
                        <label htmlFor={`line-label-${line.id}`} className="sr-only">
                          {line.dataDevice ? 'Device type' : 'Plan'}
                        </label>
                        <select
                          id={`line-label-${line.id}`}
                          value={line.dataDevice ? (['Wearable', 'Tablet'].includes(line.label) ? line.label : '') : line.label}
                          onChange={(e) => {
                            const value = e.target.value
                            if (line.dataDevice) {
                              const price = value ? ATT_DATA_DEVICE_PRICES[value] ?? 0 : 0
                              updateLine(index, {
                                label: value,
                                pricePerMonth: price,
                              })
                            } else {
                              setBill((prev) => {
                                const next = prev.lines.map((l, i) =>
                                  i === index ? { ...l, label: value } : l
                                )
                                const phoneLineCount = next.filter(
                                  (l) =>
                                    !l.dataDevice && l.label !== 'FirstNet'
                                ).length
                                return {
                                  ...prev,
                                  lines: next.map((line) => {
                                    let base: number
                                    if (line.dataDevice) {
                                      base =
                                        line.label
                                          ? ATT_DATA_DEVICE_PRICES[line.label] ??
                                            0
                                          : 0
                                    } else {
                                      base = getAttMultiLinePrice(
                                        line.label,
                                        phoneLineCount
                                      )
                                      const hotspotAdd =
                                        line.label === 'FirstNet' &&
                                        line.hotspot
                                          ? 5
                                          : 0
                                      base += hotspotAdd
                                    }
                                    const price = applyLinePriceDiscounts(
                                      next,
                                      base,
                                      line.label,
                                      prev.discount25Eligible
                                    )
                                    return { ...line, pricePerMonth: price }
                                  }),
                                }
                              })
                            }
                          }}
                          className="line-label-input"
                        >
                          {(line.dataDevice ? DATA_DEVICE_OPTIONS : (bill.discount25Eligible ? ATT_PLAN_OPTIONS.filter((o) => o.value !== 'FirstNet') : ATT_PLAN_OPTIONS)).map((opt) => (
                            <option key={opt.value || 'placeholder'} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {!line.dataDevice && line.label === 'FirstNet' && (
                          <label className="checkbox-label hotspot-checkbox">
                            <input
                              type="checkbox"
                              checked={!!line.hotspot}
                              onChange={(e) => {
                                const checked = e.target.checked
                                const currentPrice = Number(line.pricePerMonth) || 0
                                updateLine(index, {
                                  hotspot: checked,
                                  pricePerMonth: checked
                                    ? currentPrice + 5
                                    : currentPrice - 5,
                                })
                              }}
                            />
                            Hot Spot
                          </label>
                        )}
                        {!line.dataDevice && !['FirstNet', 'Premium', 'Extra'].includes(line.label) && (
                          <span className="plan-quality-warning">
                            This rate plan will negatively impact the store's quality metrics.
                          </span>
                        )}
                        {!line.dataDevice &&
                          line.label === 'Extra' &&
                          !bill.lines.some((l) => l.label === 'FirstNet') && (
                            <span className="plan-extra-signature-message">
                              If this customer qualifies for a signature discount, we can offer them better service at the same price.
                            </span>
                          )}
                      </div>
                    )}
                    {bill.carrier !== 'AT&T' && bill.carrier !== '' && (
                      <>
                        <div className="line-suggested-replacement-cell">
                          <label htmlFor={`line-suggested-${line.id}`} className="line-suggested-label">
                            {line.dataDevice ? 'Device type' : 'Suggest replace with'}
                          </label>
                          <select
                            id={`line-suggested-${line.id}`}
                            value={line.dataDevice ? (['Wearable', 'Tablet'].includes(line.label) ? line.label : '') : (line.suggestedReplacement ?? '')}
                            onChange={(e) =>
                              line.dataDevice
                                ? updateLine(index, { label: e.target.value })
                                : updateLine(index, { suggestedReplacement: e.target.value })
                            }
                            className="line-label-input"
                          >
                            {(line.dataDevice ? DATA_DEVICE_OPTIONS : SUGGESTED_REPLACEMENT_OPTIONS).map((opt) => (
                              <option key={opt.value || 'placeholder'} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="line-addons-cell">
                          <span className="line-suggested-label">Add-ons</span>
                          <div className="line-addons-checkboxes">
                            <label className="checkbox-label line-addon-checkbox">
                              <input
                                type="checkbox"
                                checked={!!line.addOnPro1}
                                onChange={(e) => updateLine(index, { addOnPro1: e.target.checked })}
                              />
                              Pro 1
                            </label>
                            <label className="checkbox-label line-addon-checkbox">
                              <input
                                type="checkbox"
                                checked={!!line.addOnPro4}
                                onChange={(e) => updateLine(index, { addOnPro4: e.target.checked })}
                              />
                              Pro 4
                            </label>
                            <label className="checkbox-label line-addon-checkbox">
                              <input
                                type="checkbox"
                                checked={!!line.addOnHtp}
                                onChange={(e) => updateLine(index, { addOnHtp: e.target.checked })}
                              />
                              HTP
                            </label>
                            <label className="checkbox-label line-addon-checkbox">
                              <input
                                type="checkbox"
                                checked={!!line.addOnTurbo}
                                onChange={(e) => updateLine(index, { addOnTurbo: e.target.checked })}
                              />
                              Turbo
                            </label>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="line-price-cell">
                    <label className="checkbox-label line-data-device-checkbox">
                      <input
                        type="checkbox"
                        checked={!!line.dataDevice}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setBill((prev) => {
                            const next = [...prev.lines]
                            next[index] = {
                              ...next[index],
                              dataDevice: checked,
                              label: '',
                            }
                            if (prev.carrier !== 'AT&T') {
                              return { ...prev, lines: next }
                            }
                            const phoneLineCount = next.filter(
                              (l) =>
                                !l.dataDevice && l.label !== 'FirstNet'
                            ).length
                            return {
                              ...prev,
                              lines: next.map((l) => {
                                let base: number
                                if (l.dataDevice) {
                                  base = l.label
                                    ? ATT_DATA_DEVICE_PRICES[l.label] ?? 0
                                    : 0
                                } else {
                                  base = getAttMultiLinePrice(
                                    l.label,
                                    phoneLineCount
                                  )
                                  const hotspotAdd =
                                    l.label === 'FirstNet' && l.hotspot
                                      ? 5
                                      : 0
                                  base += hotspotAdd
                                }
const price = applyLinePriceDiscounts(
                                next,
                                base,
                                l.label,
                                prev.discount25Eligible
                              )
                              return { ...l, pricePerMonth: price }
                            }),
                          }
                        })
                      }}
                    />
                    Data Device
                    </label>
                    <label htmlFor={`line-price-${line.id}`} className="sr-only">
                      Price per month ($)
                    </label>
                    <div className="line-price-wrap">
                    <span className="line-price-prefix">$</span>
                    <input
                      id={`line-price-${line.id}`}
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                      value={line.pricePerMonth === 0 ? '' : line.pricePerMonth}
                      onChange={(e) =>
                        updateLine(index, {
                          pricePerMonth: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="line-price-input"
                    />
                    <span className="line-price-suffix">/mo</span>
                  </div>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-remove-line"
                  onClick={() => removeLine(index)}
                  disabled={bill.lines.length <= 1}
                  title="Remove line"
                  aria-label={`Remove line ${index + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

        </div>
      </main>
    </div>
      <aside className="app-right" aria-label="Opportunities">
        <div className="opportunities">
          <h2 className="opportunities-title">Opportunities</h2>
          <label className="checkbox-label opportunities-kicker-checkbox">
            <input
              type="checkbox"
              checked={bill.kickerUnlocked}
              onChange={(e) => updateBill({ kickerUnlocked: e.target.checked })}
            />
            Kicker Unlocked
          </label>
          <div className="total-row">
            <span className="total-label">Estimated monthly total (lines)</span>
            <span className="total-amount">{formatCurrency(totalPerMonth)}</span>
          </div>
          <p className="total-before-taxes">All prices are shown before taxes.</p>
          {bill.carrier === 'AT&T' && (
            <div className="add-line-estimates">
              <div className="add-line-estimate-row">
                <span className="add-line-estimate-label">
                  Add one more line (Premium)
                </span>
                <div className="add-line-estimate-right">
                  <span className="add-line-estimate-amount">
                    {addOnePremiumIncrease >= 0 ? '+' : ''}
                    {formatCurrency(addOnePremiumIncrease)}/mo
                  </span>
                  <span className="add-line-estimate-commission">
                    Commission: ${bill.kickerUnlocked ? 30 : 15}
                  </span>
                </div>
              </div>
              <div className="add-line-estimate-row">
                <span className="add-line-estimate-label">
                  Add one more line (Extra)
                </span>
                <div className="add-line-estimate-right">
                  <span className="add-line-estimate-amount">
                    {addOneExtraIncrease >= 0 ? '+' : ''}
                    {formatCurrency(addOneExtraIncrease)}/mo
                  </span>
                  <span className="add-line-estimate-commission">
                    Commission: ${bill.kickerUnlocked ? 20 : 10}
                  </span>
                </div>
              </div>
              <div className="add-line-estimate-row">
                <span className="add-line-estimate-label">
                  Add tablet or wearable
                </span>
                <div className="add-line-estimate-right">
                  <span className="add-line-estimate-amount">
                    +$10–20/mo
                  </span>
                  <span className="add-line-estimate-commission">
                    Commission: ${bill.kickerUnlocked ? 5 : 3}
                  </span>
                </div>
              </div>
              <div className="add-line-estimate-row">
                <span className="add-line-estimate-label">
                  Add High Speed Internet
                </span>
                <div className="add-line-estimate-right">
                  <span className="add-line-estimate-amount">
                    +{formatCurrency(bill.aiaEligibility ? 47 : 60)}/mo
                  </span>
                  <span className="add-line-estimate-commission">
                    Commission: ${bill.kickerUnlocked ? 30 : 15}
                  </span>
                </div>
              </div>
              <div className="add-line-estimate-total-commission">
                Total potential commission: ${bill.kickerUnlocked ? 85 : 43}
              </div>
            </div>
          )}
          {bill.carrier !== 'AT&T' && bill.carrier !== '' && (() => {
            const premiumPitched = bill.lines.filter((l) => l.suggestedReplacement === 'Premium').length
            const extraPitched = bill.lines.filter((l) => l.suggestedReplacement === 'Extra').length
            const dataDeviceCount = bill.lines.filter((l) => l.dataDevice && ['Wearable', 'Tablet'].includes(l.label)).length
            const pro1Count = bill.lines.filter((l) => l.addOnPro1).length
            const pro4Count = bill.lines.filter((l) => l.addOnPro4).length
            const htpCount = bill.lines.filter((l) => l.addOnHtp).length
            const turboCount = bill.lines.filter((l) => l.addOnTurbo).length
            const premiumCommission = bill.kickerUnlocked ? 30 : 15
            const extraCommission = bill.kickerUnlocked ? 20 : 10
            const dataDeviceCommission = bill.kickerUnlocked ? 5 : 3
            const internetCommission = bill.kickerUnlocked ? 30 : 15
            const pro1Commission = 3
            const pro4Commission = 5
            const htpCommission = 5
            const turboCommission = 2
            const totalCommission =
              premiumPitched * premiumCommission +
              extraPitched * extraCommission +
              dataDeviceCount * dataDeviceCommission +
              (bill.internetAir ? internetCommission : 0) +
              pro1Count * pro1Commission +
              pro4Count * pro4Commission +
              htpCount * htpCommission +
              turboCount * turboCommission
            return (
              <div className="commission-breakdown-box">
                <div className="commission-breakdown-title">
                  Commission if you sell everything
                </div>
                {premiumPitched > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      Premium ({premiumPitched} line{premiumPitched !== 1 ? 's' : ''})
                    </span>
                    <span className="commission-breakdown-amount">
                      ${premiumPitched * premiumCommission}
                    </span>
                  </div>
                )}
                {extraPitched > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      Extra ({extraPitched} line{extraPitched !== 1 ? 's' : ''})
                    </span>
                    <span className="commission-breakdown-amount">
                      ${extraPitched * extraCommission}
                    </span>
                  </div>
                )}
                {dataDeviceCount > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      Tablet / Wearable ({dataDeviceCount})
                    </span>
                    <span className="commission-breakdown-amount">
                      ${dataDeviceCount * dataDeviceCommission}
                    </span>
                  </div>
                )}
                {bill.internetAir && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">High Speed Internet</span>
                    <span className="commission-breakdown-amount">${internetCommission}</span>
                  </div>
                )}
                {pro1Count > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      Pro 1 ({pro1Count})
                    </span>
                    <span className="commission-breakdown-amount">${pro1Count * pro1Commission}</span>
                  </div>
                )}
                {pro4Count > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      Pro 4 ({pro4Count})
                    </span>
                    <span className="commission-breakdown-amount">${pro4Count * pro4Commission}</span>
                  </div>
                )}
                {htpCount > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      HTP ({htpCount})
                    </span>
                    <span className="commission-breakdown-amount">${htpCount * htpCommission}</span>
                  </div>
                )}
                {turboCount > 0 && (
                  <div className="commission-breakdown-row">
                    <span className="commission-breakdown-label">
                      Turbo ({turboCount})
                    </span>
                    <span className="commission-breakdown-amount">${turboCount * turboCommission}</span>
                  </div>
                )}
                <div className="commission-breakdown-total">
                  <span className="commission-breakdown-total-label">Total commission</span>
                  <span className="commission-breakdown-total-amount">${totalCommission}</span>
                </div>
              </div>
            )
          })()}
        </div>
        <div className="export-pdf-row">
          <button
            type="button"
            className="btn-export-pdf"
            onClick={() => {
              setExportLineOutcomes(
                bill.lines.map(() => ({ sold: false, objections: '' }))
              )
              setExportInternetOutcome({ sold: false, objections: '' })
              setExportAddOnOutcomes(
                getPitchedAddOns(bill).map(({ lineIndex, addOn }) => ({
                  lineIndex,
                  addOn,
                  sold: false,
                  objections: '',
                }))
              )
              setExportFormOpen(true)
            }}
          >
            Export PDF
          </button>
        </div>
      </aside>

      {exportFormOpen && (
        <div
          className="export-form-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-form-title"
          onClick={() => setExportFormOpen(false)}
        >
          <div
            className="export-form-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="export-form-title" className="export-form-title">
              Before exporting – line outcomes
            </h2>
            <p className="export-form-description">
              For each line, indicate whether you sold it. If not, reference the customer’s objections.
            </p>
            <form
              className="export-form"
              onSubmit={(e) => {
                e.preventDefault()
                exportToPdf(
                  bill,
                  totalPerMonth,
                  addOnePremiumIncrease,
                  addOneExtraIncrease,
                  exportLineOutcomes,
                  exportInternetOutcome,
                  exportAddOnOutcomes
                )
                setExportFormOpen(false)
              }}
            >
              {bill.lines.map((line, i) => (
                <fieldset key={line.id} className="export-form-line">
                  <legend className="export-form-line-legend">
                    Line {i + 1}: {line.customerName || 'Unnamed'}
                    {line.label ? ` – ${line.label}` : ''}
                    {line.suggestedReplacement ? ` (Suggest: ${line.suggestedReplacement})` : ''}
                  </legend>
                  <div className="export-form-sold-row">
                    <span className="export-form-sold-label">Did you sell this line?</span>
                    <div className="export-form-sold-options">
                      <label className="export-form-radio">
                        <input
                          type="radio"
                          name={`sold-${i}`}
                          checked={exportLineOutcomes[i]?.sold === true}
                          onChange={() => {
                            setExportLineOutcomes((prev) => {
                              const next = [...prev]
                              if (!next[i]) next[i] = { sold: false, objections: '' }
                              next[i] = { ...next[i], sold: true }
                              return next
                            })
                          }}
                        />
                        Yes
                      </label>
                      <label className="export-form-radio">
                        <input
                          type="radio"
                          name={`sold-${i}`}
                          checked={exportLineOutcomes[i]?.sold === false}
                          onChange={() => {
                            setExportLineOutcomes((prev) => {
                              const next = [...prev]
                              if (!next[i]) next[i] = { sold: false, objections: '' }
                              next[i] = { ...next[i], sold: false }
                              return next
                            })
                          }}
                        />
                        No
                      </label>
                    </div>
                  </div>
                  {exportLineOutcomes[i]?.sold === false && (
                    <div className="export-form-objections">
                      <label htmlFor={`objections-${i}`}>Customer’s objections</label>
                      <textarea
                        id={`objections-${i}`}
                        placeholder="Reference the customer’s objections…"
                        value={exportLineOutcomes[i]?.objections ?? ''}
                        onChange={(e) => {
                          setExportLineOutcomes((prev) => {
                            const next = [...prev]
                            if (!next[i]) next[i] = { sold: false, objections: '' }
                            next[i] = { ...next[i], objections: e.target.value }
                            return next
                          })
                        }}
                        rows={2}
                      />
                    </div>
                  )}
                </fieldset>
              ))}
              <fieldset className="export-form-line">
                <legend className="export-form-line-legend">High Speed Internet</legend>
                <div className="export-form-sold-row">
                  <span className="export-form-sold-label">Did you sell internet?</span>
                  <div className="export-form-sold-options">
                    <label className="export-form-radio">
                      <input
                        type="radio"
                        name="internet-sold"
                        checked={exportInternetOutcome.sold === true}
                        onChange={() =>
                          setExportInternetOutcome((prev) => ({ ...prev, sold: true }))
                        }
                      />
                      Yes
                    </label>
                    <label className="export-form-radio">
                      <input
                        type="radio"
                        name="internet-sold"
                        checked={exportInternetOutcome.sold === false}
                        onChange={() =>
                          setExportInternetOutcome((prev) => ({ ...prev, sold: false }))
                        }
                      />
                      No
                    </label>
                  </div>
                </div>
                {exportInternetOutcome.sold === false && (
                  <div className="export-form-objections">
                    <label htmlFor="objections-internet">Customer’s objections</label>
                    <textarea
                      id="objections-internet"
                      placeholder="Reference the customer’s objections…"
                      value={exportInternetOutcome.objections}
                      onChange={(e) =>
                        setExportInternetOutcome((prev) => ({
                          ...prev,
                          objections: e.target.value,
                        }))
                      }
                      rows={2}
                    />
                  </div>
                )}
              </fieldset>
              {exportAddOnOutcomes.length > 0 && (
                <>
                  <p className="export-form-addons-intro">For each add-on that was pitched, indicate whether you sold it.</p>
                  {exportAddOnOutcomes.map((outcome, idx) => {
                    const line = bill.lines[outcome.lineIndex]
                    return (
                      <fieldset key={`${outcome.lineIndex}-${outcome.addOn}`} className="export-form-line">
                        <legend className="export-form-line-legend">
                          Line {outcome.lineIndex + 1}: {line?.customerName || 'Unnamed'} – {outcome.addOn}
                        </legend>
                        <div className="export-form-sold-row">
                          <span className="export-form-sold-label">Did you sell this add-on?</span>
                          <div className="export-form-sold-options">
                            <label className="export-form-radio">
                              <input
                                type="radio"
                                name={`addon-sold-${idx}`}
                                checked={outcome.sold === true}
                                onChange={() => {
                                  setExportAddOnOutcomes((prev) => {
                                    const next = [...prev]
                                    next[idx] = { ...next[idx], sold: true }
                                    return next
                                  })
                                }}
                              />
                              Yes
                            </label>
                            <label className="export-form-radio">
                              <input
                                type="radio"
                                name={`addon-sold-${idx}`}
                                checked={outcome.sold === false}
                                onChange={() => {
                                  setExportAddOnOutcomes((prev) => {
                                    const next = [...prev]
                                    next[idx] = { ...next[idx], sold: false }
                                    return next
                                  })
                                }}
                              />
                              No
                            </label>
                          </div>
                        </div>
                        {outcome.sold === false && (
                          <div className="export-form-objections">
                            <label htmlFor={`objections-addon-${idx}`}>Customer’s objections</label>
                            <textarea
                              id={`objections-addon-${idx}`}
                              placeholder="Reference the customer’s objections…"
                              value={outcome.objections}
                              onChange={(e) => {
                                setExportAddOnOutcomes((prev) => {
                                  const next = [...prev]
                                  next[idx] = { ...next[idx], objections: e.target.value }
                                  return next
                                })
                              }}
                              rows={2}
                            />
                          </div>
                        )}
                      </fieldset>
                    )
                  })}
                </>
              )}
              <div className="export-form-actions">
                <button
                  type="button"
                  className="btn-export-cancel"
                  onClick={() => setExportFormOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-export-submit">
                  Generate PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
