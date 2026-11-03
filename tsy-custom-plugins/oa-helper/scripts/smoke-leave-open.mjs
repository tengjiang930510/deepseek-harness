import { submitLeaveForm } from '../lib/leave-open.js'

const result = await submitLeaveForm({
  leaveType: process.env.LEAVE_TYPE || 'sick',
  startDate: process.env.LEAVE_START || '2026-10-11',
  endDate: process.env.LEAVE_END || '2026-10-18',
  reason: process.env.LEAVE_REASON || '回家看病',
  headed: true,
  // Default: fill only. Set LEAVE_SUBMIT=1 to click 发起流程.
  submit: process.env.LEAVE_SUBMIT === '1',
})
console.log(JSON.stringify(result, null, 2))
