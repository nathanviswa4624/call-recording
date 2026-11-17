'use client';
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { CatalogOption, ParamValue, Params } from '@/lib/api/types';
import { Button, Field, Input, Select } from '@/components/ui/primitives';

/** Option names managed by dedicated fields (excluded from the generic editor). */
export function ParamsEditor({ options, value, onChange, exclude = [], errors = {} }: {
  options: CatalogOption[]; value: Params; onChange: (p: Params) => void; exclude?: string[]; errors?: Record<string, string>;
}) {
  const [adding, setAdding] = useState('');
  const visible = useMemo(() => options.filter((o) => !exclude.includes(o.name) && o.type !== 'secret'), [options, exclude]);
  const common = visible.filter((o) => o.common);
  const advancedSet = visible.filter((o) => !o.common && Object.prototype.hasOwnProperty.call(value, o.name));
  const addable = visible.filter((o) => !o.common && !Object.prototype.hasOwnProperty.call(value, o.name));

  const set = (k: string, v: ParamValue | undefined) => {
    const next = { ...value };
    if (v === undefined) delete next[k]; else next[k] = v;
    onChange(next);
  };

  const control = (o: CatalogOption, id: string) => {
    const v = value[o.name];
    if (o.type === 'bool') {
      return (
        <Select id={id} value={v === undefined || v === null ? '' : v === true || v === 'yes' ? 'yes' : 'no'} onChange={(e) => set(o.name, e.target.value === '' ? undefined : e.target.value === 'yes')}>
          <option value="">(Asterisk default)</option><option value="yes">yes</option><option value="no">no</option>
        </Select>
      );
    }
    if (o.type === 'enum') {
      return (
        <Select id={id} value={v === undefined || v === null ? '' : String(v)} onChange={(e) => set(o.name, e.target.value || undefined)}>
          <option value="">(Asterisk default)</option>
          {o.values?.map((x) => <option key={x}>{x}</option>)}
        </Select>
      );
    }
    return (
      <Input id={id} type={o.type === 'int' ? 'number' : 'text'} min={o.min} max={o.max} value={v === undefined || v === null ? '' : String(v)}
        onChange={(e) => set(o.name, e.target.value === '' ? undefined : o.type === 'int' ? Number(e.target.value) : e.target.value)} />
    );
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {common.map((o) => <Field key={o.name} label={o.name} error={errors[o.name]} help={o.since ? `Asterisk ${o.since}+` : undefined}>{(id) => control(o, id)}</Field>)}
      </div>
      {advancedSet.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Advanced options</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {advancedSet.map((o) => (
              <div key={o.name} className="flex items-end gap-1">
                <Field label={o.name} error={errors[o.name]} className="flex-1">{(id) => control(o, id)}</Field>
                <Button size="sm" variant="ghost" aria-label={`Remove ${o.name}`} icon={<X className="size-3.5" />} onClick={() => set(o.name, undefined)} />
              </div>
            ))}
          </div>
        </div>
      )}
      {addable.length > 0 && (
        <div className="flex items-end gap-2">
          <Field label="Add advanced / custom option" className="w-80">{(id) => (
            <Select id={id} value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Select a supported option…</option>
              {addable.map((o) => <option key={o.name} value={o.name}>{o.name}{o.since ? ` (${o.since}+)` : ''}</option>)}
            </Select>
          )}</Field>
          <Button size="sm" icon={<Plus className="size-3.5" />} disabled={!adding} onClick={() => { set(adding, ''); setAdding(''); }}>Add</Button>
          <span className="pb-1.5 text-[12px] text-muted">Only options supported by this server&apos;s Asterisk version are listed.</span>
        </div>
      )}
    </div>
  );
}
