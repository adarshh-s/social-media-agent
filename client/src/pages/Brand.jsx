import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { toast } from '../components/ui';

const FIELDS = [
  ['name', 'Name or brand', 'e.g. Alex Kim — Founder of Acme', false],
  ['role', 'What you do', 'e.g. Building AI tools for small retailers', false],
  ['audience', 'Who you are writing for', 'e.g. Founders and ops leads at 10–200 person companies', false],
  ['topics', 'Core topics', 'e.g. AI in retail, bootstrapping, product design', true],
  ['voice', 'Voice & style', 'e.g. Direct, warm, a little witty. Short sentences. Uses real examples.', true],
  ['avoid', 'Avoid', 'e.g. Buzzwords, "I\'m humbled to announce", more than 2 emojis', true],
  ['examples', 'Your best past posts (the biggest quality boost)', 'Paste 3–5 of your best-performing posts, separated by a line with ---', true],
];

export default function Brand() {
  const [brand, setBrand] = useState(null);
  useEffect(() => { api.get('/settings/brand').then(setBrand).catch((e) => toast(e.message, 'err')); }, []);

  const save = async () => {
    try {
      setBrand(await api.put('/settings/brand', brand));
      toast('Brand voice saved — all AI writing will use it');
    } catch (e) { toast(e.message, 'err'); }
  };

  if (!brand) return null;
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Brand voice</h1>
          <p className="muted">The AI uses this profile for every post, comment, reply, plan and poster.</p>
        </div>
      </header>
      <section className="card">
        {FIELDS.map(([k, label, ph, multi]) => (
          <label key={k}>{label}
            {multi
              ? <textarea rows={k === 'examples' ? 12 : 3} value={brand[k]} placeholder={ph} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />
              : <input value={brand[k]} placeholder={ph} onChange={(e) => setBrand({ ...brand, [k]: e.target.value })} />}
          </label>
        ))}
        <button className="btn" onClick={save}>Save</button>
      </section>
    </div>
  );
}
