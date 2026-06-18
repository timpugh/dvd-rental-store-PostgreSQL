// ---- pure: terminal-style table (psql-like) ----
function formatTable(columns, rows) {
  if (!columns.length) return '(0 rows)';
  const cell = (x) => (x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x));
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => cell(r[c]).length), 0),
  );
  const line = (cells) => cells.map((v, i) => String(v).padEnd(widths[i])).join(' | ');
  const sep = widths.map((w) => '-'.repeat(w)).join('-+-');
  const body = rows.map((r) => line(columns.map((c) => cell(r[c]))));
  const count = `(${rows.length} row${rows.length === 1 ? '' : 's'})`;
  return [line(columns), sep, ...body, '', count].join('\n');
}

// ---- example prompts (each tagged with the data it searches) ----
const EXAMPLES = [
  ['Which actors appear in the most films?', 'actor · film_actor · film'],
  ['Show the 5 longest films with their length and rating', 'film · length · mpaa_rating enum'],
  ['How many films are in each category?', 'category · film_category'],
  ['How many films are available in each language?', 'language · film'],
  ['How many copies of "ACADEMY DINOSAUR" are at each store?', 'inventory · store · film'],
  ['Which films are rented out right now and not yet returned?', 'rental · inventory (timestamps)'],
  ['Which 5 customers have spent the most, and how much?', 'payment · customer (money)'],
  ['How many active vs inactive customers are there?', 'customer (boolean active)'],
  ['List customers located in Canada', 'customer · address · city · country'],
  ['Total revenue per store, and the staff who processed it', 'store · staff · payment'],
  ['How many films have each MPAA rating (G, PG, R, …)?', 'film.rating (enum)'],
  ['Find films whose description mentions "astronaut"', 'film.fulltext (full-text search)'],
  ['How many rentals happened per month?', 'rental.rental_date (date series)'],
  ['Average rental rate and replacement cost by rating', 'film (numeric aggregates)'],
  ['Show 10 rows from the film_list view', 'film_list (view)'],
  ['How many apt packages are recorded, and list 5 of their names?', 'packages_apt… (jsonb)'],
  ['Show the 5 most recently updated yum packages', 'packages_yum… (jsonb)'],
];

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);

  function renderExamples() {
    const grid = $('examples');
    EXAMPLES.forEach(([q, tag]) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.innerHTML = `<span class="chip-q"></span><span class="chip-tag"></span>`;
      chip.querySelector('.chip-q').textContent = q;
      chip.querySelector('.chip-tag').textContent = tag;
      chip.addEventListener('click', () => {
        $('prompt').value = q;
        $('prompt').focus();
      });
      grid.appendChild(chip);
    });
  }

  function show(el, on) {
    el.style.display = on ? '' : 'none';
  }

  async function run() {
    const prompt = $('prompt').value.trim();
    if (!prompt) return;
    const out = $('output');
    show(out, true);
    $('req').textContent = prompt;
    $('sql').textContent = '…';
    $('table').textContent = '';
    $('explain').textContent = 'Thinking…';
    $('runBtn').disabled = true;
    try {
      const res = await fetch(window.PAGILA_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      $('sql').textContent = data.sql || '(none)';
      if (data.error) {
        $('table').textContent = '';
        $('explain').textContent = data.error;
      } else {
        $('table').textContent = formatTable(data.columns || [], data.rows || []);
        $('explain').textContent = data.explanation || '';
      }
    } catch (e) {
      $('explain').textContent =
        'Database is waking up or the request timed out — please try again in a few seconds.';
    } finally {
      $('runBtn').disabled = false;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    renderExamples();
    $('runBtn').addEventListener('click', run);
    $('prompt').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
    });
  });
}

if (typeof module !== 'undefined') module.exports = { formatTable };
