import Portal from '@/components/Portal';

/* Deep link from the email "view your ticket" button: /t/HDS-NNNN.
   Renders the portal with that ticket opened once the session is restored. */
export default function TicketDeepLink({ params }: { params: { ref: string } }) {
  return <Portal initialTicketId={decodeURIComponent(params.ref)} />;
}
