'use client';
import { Suspense } from 'react';
import { CallHistory } from '@/components/domain/call-history';

const MISSED = ['NO_ANSWER', 'ABANDONED'];

export default function MissedCallsPage() {
  return <Suspense><CallHistory title="Missed Calls" description="Calls that were not answered or were abandoned." presetStatus={MISSED} /></Suspense>;
}
