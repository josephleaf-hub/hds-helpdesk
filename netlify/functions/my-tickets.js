/**
 * HDS IT Helpdesk — My Tickets Function
 * GET /api/my-tickets?email=staff@homedelivery.com.au
 *
 * Returns all tickets submitted by a given email address.
 * Uses service role key — secure server-side query.
 */

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const email = event.queryStringParameters?.email?.toLowerCase().trim();

  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email is required' }) };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase
    .from('tickets')
    .select(`
      id, category, sub_type, priority, subject, description,
      department, location, affected_user, status, assigned_to,
      created_at, updated_at, resolved_at,
      ticket_notes (id, added_by, note_text, created_at)
    `)
    .eq('requester_email', email)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Query error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch tickets' }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(data || []),
  };
};
