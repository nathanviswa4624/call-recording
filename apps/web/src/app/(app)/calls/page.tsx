'use client';
import { Suspense } from 'react';
import { CallHistory } from '@/components/domain/call-history';

export default function CallsPage() {
  return <Suspense><CallHistory title="Call History" description="All imported calls (CDR), newest first. Agents only see their own calls." /></Suspense>;
}
