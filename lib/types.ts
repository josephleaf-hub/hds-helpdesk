export type TicketStatus =
  | 'open' | 'in-progress' | 'waiting-on-admin' | 'waiting-on-requester' | 'on-hold' | 'resolved' | 'closed';
export type NoteType = 'outbound' | 'inbound' | 'internal';

export interface Note {
  id: string;
  ticket_id?: string;
  added_by: string;
  note_text: string;
  note_type: NoteType;
  created_at: string;
}

export interface Ticket {
  id: string;
  category: string;
  sub_type: string;
  priority: string;
  status: TicketStatus;
  subject: string;
  description: string;
  requester_name: string;
  requester_email: string;
  department: string;
  location: string | null;
  affected_user: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string | null;
  resolved_at: string | null;
  deleted_at?: string | null;
  ticket_notes?: Note[];
}

export interface AttachItem { url: string; name: string; mime: string; }
export type AttachMap = Record<string, AttachItem[]>;

export interface UserRole {
  role: 'admin' | 'manager';
  department: string | null;
  full_name: string;
}
