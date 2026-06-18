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

// ---- schema reference (what fields are available to query) ----
const SCHEMA = [
  ['Films & catalog', [
    ['film', 'film_id, title, description, release_year, language_id, rental_rate, length, replacement_cost, rating, fulltext'],
    ['actor', 'actor_id, first_name, last_name'],
    ['category', 'category_id, name'],
    ['language', 'language_id, name'],
    ['film_actor', 'actor_id, film_id'],
    ['film_category', 'film_id, category_id'],
  ]],
  ['Inventory, rentals & payments', [
    ['inventory', 'inventory_id, film_id, store_id'],
    ['rental', 'rental_id, rental_date, return_date, inventory_id, customer_id, staff_id'],
    ['payment', 'payment_id, customer_id, staff_id, rental_id, amount, payment_date'],
    ['store', 'store_id, manager_staff_id, address_id'],
    ['staff', 'staff_id, first_name, last_name, email, store_id, active, username'],
  ]],
  ['Customers & locations', [
    ['customer', 'customer_id, store_id, first_name, last_name, email, address_id, activebool, create_date'],
    ['address', 'address_id, address, district, city_id, postal_code, phone'],
    ['city', 'city_id, city, country_id'],
    ['country', 'country_id, country'],
  ]],
  ['PostgreSQL package data — a JSONB demo, not part of the rental store', [
    ['packages_apt_postgresql_org', "id, last_updated, aptdata (jsonb keys: Package, Version, Size…)"],
    ['packages_yum_postgresql_org', "id, last_updated, yumdata (jsonb keys: name, version, size…)"],
  ]],
];
const SCHEMA_TIPS =
  "Tips: film.rating is an enum (G, PG, PG-13, R, NC-17) · full-text search via film.fulltext (to_tsquery) · " +
  "read JSONB fields with ->> e.g. aptdata->>'Package' · views: film_list, sales_by_store, sales_by_film_category.";

if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);

  function renderSchema() {
    const root = $('schema');
    if (!root) return;
    SCHEMA.forEach(([group, tables]) => {
      const h = document.createElement('h3');
      h.textContent = group;
      root.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'schema-grid';
      tables.forEach(([name, cols]) => {
        const card = document.createElement('div');
        card.className = 'tbl';
        const n = document.createElement('span');
        n.className = 'tbl-name';
        n.textContent = name;
        const c = document.createElement('span');
        c.className = 'tbl-cols';
        c.textContent = cols;
        card.append(n, c);
        grid.appendChild(card);
      });
      root.appendChild(grid);
    });
    const tips = document.createElement('p');
    tips.className = 'schema-tips';
    tips.textContent = SCHEMA_TIPS;
    root.appendChild(tips);
  }

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
    renderSchema();
    $('runBtn').addEventListener('click', run);
    $('prompt').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
    });
  });
}

if (typeof module !== 'undefined') module.exports = { formatTable };
