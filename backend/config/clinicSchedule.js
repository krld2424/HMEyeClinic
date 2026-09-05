/**
 * Clinic Operating Schedule
 * Defines the clinic's official operating hours and appointment slot configuration
 */

// Operating hours for each day of the week
// Time format: "HH:MM" (24-hour format)
// dayOfWeek: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
export const clinicSchedule = {
  // Monday to Friday: 9:00 AM to 6:00 PM
  1: { open: '09:00', close: '18:00', label: 'Monday', operatingDay: true },
  2: { open: '09:00', close: '18:00', label: 'Tuesday', operatingDay: true },
  3: { open: '09:00', close: '18:00', label: 'Wednesday', operatingDay: true },
  4: { open: '09:00', close: '18:00', label: 'Thursday', operatingDay: true },
  5: { open: '09:00', close: '18:00', label: 'Friday', operatingDay: true },
  // Saturday: 8:30 AM to 5:30 PM
  6: { open: '08:30', close: '17:30', label: 'Saturday', operatingDay: true },
  // Sunday: By Appointment Only
  0: { open: null, close: null, label: 'Sunday', operatingDay: false },
};

/**
 * Appointment slot configuration
 * Slots are in 24-hour format (HH:MM)
 * The system will filter these slots based on the clinic's operating hours for each day
 */
export const appointmentSlotTimes = [
  '09:00', '09:30', '10:00', '10:30',
  '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30',
  '15:00', '15:30', '16:00', '16:30',
  '17:00', '17:30',
];

/**
 * Appointment duration in minutes
 * Used to validate that appointments don't extend beyond closing time
 */
export const APPOINTMENT_DURATION_MINUTES = 30;

/**
 * Format time to 12-hour AM/PM format for display
 * @param {string} time - Time in HH:MM format (24-hour)
 * @returns {string} Time in 12-hour AM/PM format
 */
export const formatTime12Hour = (time) => {
  if (!time || typeof time !== 'string') return '';
  const [hours, minutes] = time.split(':');
  const hour = parseInt(hours, 10);
  const minute = parseInt(minutes, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, '0')} ${ampm}`;
};

/**
 * Get clinic schedule information for a specific date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {object} Schedule info: { dayOfWeek, label, open, close, operatingDay, openFormatted, closeFormatted }
 */
export const getClinicScheduleForDate = (dateString) => {
  const date = new Date(`${dateString}T00:00:00`);
  const dayOfWeek = date.getDay();
  const scheduleInfo = clinicSchedule[dayOfWeek];

  if (!scheduleInfo) {
    return { dayOfWeek, label: 'Unknown', operatingDay: false };
  }

  return {
    dayOfWeek,
    label: scheduleInfo.label,
    open: scheduleInfo.open,
    close: scheduleInfo.close,
    operatingDay: scheduleInfo.operatingDay,
    openFormatted: scheduleInfo.open ? formatTime12Hour(scheduleInfo.open) : null,
    closeFormatted: scheduleInfo.close ? formatTime12Hour(scheduleInfo.close) : null,
  };
};

/**
 * Get available appointment slots for a specific date
 * Filters the appointment slot times based on clinic operating hours for that day
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {array} Array of available time slots in 24-hour format (HH:MM)
 */
export const getAvailableSlotsForDate = (dateString) => {
  const scheduleInfo = getClinicScheduleForDate(dateString);

  // If the clinic is not operating on this day, return empty array
  if (!scheduleInfo.operatingDay || !scheduleInfo.open || !scheduleInfo.close) {
    return [];
  }

  // Filter appointment slots that fall within operating hours
  // and ensure the appointment won't extend beyond closing time
  const availableSlots = appointmentSlotTimes.filter((slotTime) => {
    // Convert time strings to minutes for comparison
    const [slotHours, slotMinutes] = slotTime.split(':').map(Number);
    const slotTotalMinutes = slotHours * 60 + slotMinutes;

    const [openHours, openMinutes] = scheduleInfo.open.split(':').map(Number);
    const openTotalMinutes = openHours * 60 + openMinutes;

    const [closeHours, closeMinutes] = scheduleInfo.close.split(':').map(Number);
    const closeTotalMinutes = closeHours * 60 + closeMinutes;

    // Appointment start time must be at or after opening time
    if (slotTotalMinutes < openTotalMinutes) {
      return false;
    }

    // Appointment end time (start + duration) must be before or at closing time
    const appointmentEndTime = slotTotalMinutes + APPOINTMENT_DURATION_MINUTES;
    if (appointmentEndTime > closeTotalMinutes) {
      return false;
    }

    return true;
  });

  return availableSlots;
};

/**
 * Validate if a requested appointment time is valid for a given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {string} timeString - Time in HH:MM format (24-hour)
 * @returns {object} Validation result: { valid: boolean, error?: string }
 */
export const validateAppointmentTime = (dateString, timeString) => {
  const availableSlots = getAvailableSlotsForDate(dateString);

  // Convert 12-hour format (if provided) back to 24-hour for comparison
  let time24Hr = timeString;
  if (timeString.includes('AM') || timeString.includes('PM')) {
    // This is 12-hour format - convert it to 24-hour
    time24Hr = convert12HourTo24Hour(timeString);
  }

  if (!availableSlots.includes(time24Hr)) {
    const scheduleInfo = getClinicScheduleForDate(dateString);
    if (!scheduleInfo.operatingDay) {
      return { valid: false, error: 'The clinic is not open on this day. Sunday appointments are by appointment only.' };
    }
    return { valid: false, error: `This time is not available. Clinic hours: ${scheduleInfo.openFormatted} - ${scheduleInfo.closeFormatted}` };
  }

  return { valid: true };
};

/**
 * Convert 12-hour format time to 24-hour format
 * @param {string} time12Hr - Time in 12-hour AM/PM format (e.g., "9:30 AM", "2:00 PM")
 * @returns {string} Time in 24-hour format (HH:MM)
 */
export const convert12HourTo24Hour = (time12Hr) => {
  if (!time12Hr || typeof time12Hr !== 'string') return '';

  const match = time12Hr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return '';

  let [, hoursStr, minutesStr, meridiem] = match;
  let hours = parseInt(hoursStr, 10);
  const minutes = minutesStr;

  if (meridiem.toUpperCase() === 'PM' && hours !== 12) {
    hours += 12;
  } else if (meridiem.toUpperCase() === 'AM' && hours === 12) {
    hours = 0;
  }

  return `${String(hours).padStart(2, '0')}:${minutes}`;
};

/**
 * Format clinic hours for display
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Formatted display string (e.g., "9:00 AM - 6:00 PM" or "By Appointment Only")
 */
export const getFormattedClinicHours = (dateString) => {
  const scheduleInfo = getClinicScheduleForDate(dateString);

  if (!scheduleInfo.operatingDay) {
    return 'By Appointment Only';
  }

  return `${scheduleInfo.openFormatted} - ${scheduleInfo.closeFormatted}`;
};
