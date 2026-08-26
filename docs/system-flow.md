# HM VisionSync System Flow

## Architecture

HM VisionSync uses three layers:

1. **Astro frontend** serves the clinic site, login and registration pages, dashboards, and role-specific task pages.
2. **Express backend** exposes authentication, appointment, content, and administration APIs.
3. **MongoDB** stores users, appointments, and future clinical, billing, notification, and audit records.

The browser calls the backend at `http://localhost:5000`. In production, configure the frontend API URL and use HTTPS.

## Authentication Flow

1. A patient submits `/register` with structured identity fields.
2. The backend validates the request, hashes the password with bcrypt, and always assigns the `patient` role.
3. Login submits email and password to `/api/auth/login`.
4. The backend verifies the password and returns a seven-day JWT containing the user id, email, and role.
5. The frontend stores the token and user summary in local storage, then redirects to `/dashboard/{role}/dashboard`.
6. Dashboard pages verify the stored role before rendering. API requests send the token as `Authorization: Bearer <token>`.

The Owner account is provisioned from `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` after a successful database connection. Existing accounts using the former `superadmin` role are migrated to `owner` during provisioning. The Owner creates optometrist and eye care assistant accounts through protected `/api/admin/users` routes.

## Role Boundaries

- **Patient:** can view their own appointments and personal care information.
- **Owner:** can manage non-owner accounts and system configuration, and can use optometrist appointment and clinical workflows.
- **Optometrist:** can view clinic appointments and update appointment status; clinical record APIs should further restrict access to assigned or authorized patients.
- **Eye Care Assistant:** can view clinic appointments and operate scheduling and queue workflows; restricted clinical data must remain unavailable.

Backend middleware enforces authentication and role checks. Frontend redirects are only a usability layer and are not a security boundary.

## Appointment Flow

1. The patient opens `/dashboard/patient/book-exam` or the public booking form.
2. The date input rejects dates before today in the browser.
3. The backend repeats this validation so direct API requests cannot submit past dates.
4. The backend checks the requested date/time pair for an active appointment and rejects conflicts.
5. A new appointment is saved with `pending` status.
6. Optional SMTP notifications are sent to the clinic and patient.
7. Owners, optometrists, and eye care assistants can update status to `confirmed`, `completed`, `cancelled`, `rescheduled`, or `no-show`.
8. Patients retrieve only their own records through `/api/appointments/mine`.

## Dashboard Routing

Each role has an overview route and dedicated task routes:

- `/dashboard/patient/{section}`
- `/dashboard/optometrist/{section}`
- `/dashboard/eye-care-assistant/{section}`
- `/dashboard/owner/{section}`

The shared Astro route `frontend/src/pages/dashboard/[role]/[section].astro` renders the common shell, sidebar, loading/error states, and role-specific workflow surfaces. Existing `/dashboard/{role}` overview pages remain available.

Owner route aliases `/dashboard/owner/managed-users` and `/dashboard/owner/audit-access` are preserved while the canonical routes are `/manage-users` and `/audit-logs`.

## Environment and Local Run

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `MONGODB_URI`, `JWT_SECRET`, and Owner provisioning credentials (`SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`).
3. For local MongoDB, use `mongodb://127.0.0.1:27017/hm_visionsync`.
4. Set `RESEND_API_KEY` to the key from the Resend dashboard and set `MAIL_FROM` to a sender Resend allows. For production, verify your domain in Resend and use an address from that domain. The example `onboarding@resend.dev` sender is for Resend testing only.
5. Start both applications with `npm run dev`.
6. Open `http://localhost:4321`.
7. Check backend health at `http://localhost:5000/api/health`.

### Password reset with Resend

The login page already provides the complete flow:

1. `POST /api/auth/forgot-password` creates a random six-digit OTP, stores only its hash, and sends it through Resend. The code expires after 10 minutes.
2. `POST /api/auth/verify-otp` validates the email and OTP, then returns a short-lived reset token.
3. `POST /api/auth/reset-password` accepts that reset token and the new password.

Keep `RESEND_API_KEY` on the backend only. Add it to the backend `.env` locally and to the backend hosting provider's environment variables; never put it in `PUBLIC_*` frontend variables or commit it to the repository.

Never commit `backend/.env`; it is ignored by `.gitignore`. Rotate credentials immediately if they are exposed.

## Current Extension Points

Clinical consultations, prescriptions, medical records, notifications, billing, reports, permissions, clinic settings, and audit logs have dedicated frontend routes and protected role boundaries ready for their MongoDB models and APIs. Add each model and route without weakening the ownership and role checks described above.
