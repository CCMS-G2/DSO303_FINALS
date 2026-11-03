-- CCMS local database: one Postgres instance, one schema per service.
-- This mirrors the proposal: each service owns its schema and connects
-- with its own role in production; locally we use one shared user for simplicity.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gives us gen_random_uuid()

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS complaint;
CREATE SCHEMA IF NOT EXISTS notification;

-- ========================= auth schema =========================

CREATE TABLE auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name     text NOT NULL,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('STUDENT', 'STAFF', 'ADMIN')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Seed users (password for all three is: Password123!)
-- Hash generated with bcrypt, cost factor 10, see services/auth-service/scripts/hash.js
INSERT INTO auth.users (full_name, email, password_hash, role) VALUES
  ('Admin User', 'admin@ccms.edu', '$2b$10$hWb9n/IfGelXkaDqcke5ce91Pc3c0g/p2WSpf8yxWsBPzvfSZWIme', 'ADMIN'),
  ('Sonam Staff', 'staff@ccms.edu', '$2b$10$hWb9n/IfGelXkaDqcke5ce91Pc3c0g/p2WSpf8yxWsBPzvfSZWIme', 'STAFF'),
  ('Tashi Student', 'student@ccms.edu', '$2b$10$hWb9n/IfGelXkaDqcke5ce91Pc3c0g/p2WSpf8yxWsBPzvfSZWIme', 'STUDENT');

-- ========================= complaint schema =========================

CREATE TABLE complaint.categories (
  id        serial PRIMARY KEY,
  name      text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

INSERT INTO complaint.categories (name) VALUES
  ('Internet/Wi-Fi'), ('Electrical'), ('Plumbing'), ('Classroom/Lab'), ('Hostel'), ('Cleaning'), ('Other');

CREATE TABLE complaint.locations (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  building      text,
  location_type text,
  is_active     boolean NOT NULL DEFAULT true
);

INSERT INTO complaint.locations (name, building, location_type) VALUES
  ('Room 204', 'Academic Block A', 'Academic'),
  ('Boys Hostel Block 2', 'Hostel', 'Hostel'),
  ('Girls Hostel Block 1', 'Hostel', 'Hostel'),
  ('Computer Lab 1', 'Academic Block B', 'Academic'),
  ('Main Canteen', 'Canteen', 'Outdoor');

CREATE SEQUENCE complaint.reference_seq START 1;

CREATE TABLE complaint.complaints (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_no      text NOT NULL UNIQUE,
  student_id        uuid NOT NULL,
  assigned_staff_id uuid,
  category_id       int NOT NULL REFERENCES complaint.categories(id),
  location_id       int NOT NULL REFERENCES complaint.locations(id),
  title             text NOT NULL,
  description       text NOT NULL,
  status            text NOT NULL DEFAULT 'SUBMITTED'
                      CHECK (status IN ('SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  image_key         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  assigned_at       timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_complaints_student ON complaint.complaints (student_id, created_at);
CREATE INDEX idx_complaints_staff ON complaint.complaints (assigned_staff_id, status);
CREATE INDEX idx_complaints_status ON complaint.complaints (status, created_at);

CREATE TABLE complaint.complaint_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  uuid NOT NULL REFERENCES complaint.complaints(id),
  author_id     uuid NOT NULL,
  note          text NOT NULL,
  is_resolution boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE complaint.complaint_status_history (
  id           bigserial PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES complaint.complaints(id),
  from_status  text,
  to_status    text NOT NULL,
  changed_by   uuid NOT NULL,
  note         text,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- ========================= notification schema =========================

CREATE TABLE notification.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL UNIQUE, -- idempotency key, as in the proposal's reliability design
  user_id      uuid NOT NULL,
  complaint_id uuid,
  type         text NOT NULL,
  message      text NOT NULL,
  is_read      boolean NOT NULL DEFAULT false,
  email_sent   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user ON notification.notifications (user_id, is_read);
