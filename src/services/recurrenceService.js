// Given a completed booking's scheduledTime and a recurrenceRule
// ('DAILY' | 'WEEKLY' | 'MONTHLY'), returns the Date of the next occurrence.
function getNextOccurrence(fromDate, recurrenceRule) {
  const next = new Date(fromDate);

  switch (recurrenceRule) {
    case 'DAILY':
      next.setDate(next.getDate() + 1);
      break;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7);
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + 1);
      break;
    default:
      return null; // অজানা rule হলে কিছু করার নেই
  }

  return next;
}

module.exports = { getNextOccurrence };
