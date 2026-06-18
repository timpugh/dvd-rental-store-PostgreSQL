/** Curated Pagila schema reference used as the Bedrock system prompt. */
export const PAGILA_SCHEMA = `Tables (PostgreSQL, schema "public"):
actor(actor_id PK, first_name, last_name, last_update)
film(film_id PK, title, description, release_year, language_id FK->language, original_language_id FK->language,
     rental_duration, rental_rate numeric, length int, replacement_cost numeric, rating mpaa_rating ENUM('G','PG','PG-13','R','NC-17'),
     last_update, special_features text[], fulltext tsvector)
film_actor(actor_id FK->actor, film_id FK->film, PK(actor_id,film_id))
category(category_id PK, name, last_update)
film_category(film_id FK->film, category_id FK->category, PK(film_id,category_id))
language(language_id PK, name, last_update)
inventory(inventory_id PK, film_id FK->film, store_id FK->store, last_update)
rental(rental_id PK, rental_date timestamptz, inventory_id FK->inventory, customer_id FK->customer,
       return_date timestamptz, staff_id FK->staff, last_update)
payment(payment_id, customer_id FK->customer, staff_id FK->staff, rental_id FK->rental, amount numeric,
        payment_date timestamptz)  -- PARTITIONED by payment_date (monthly partitions payment_p2022_01..07)
customer(customer_id PK, store_id FK->store, first_name, last_name, email, address_id FK->address,
         activebool boolean, active int, create_date, last_update)
address(address_id PK, address, address2, district, city_id FK->city, postal_code, phone, last_update)
city(city_id PK, city, country_id FK->country, last_update)
country(country_id PK, country, last_update)
store(store_id PK, manager_staff_id FK->staff, address_id FK->address, last_update)
staff(staff_id PK, first_name, last_name, address_id FK->address, email, store_id FK->store, active boolean,
      username, last_update)
packages_apt_postgresql_org(id PK, last_updated timestamp, aptdata jsonb)  -- JSONB; aptdata has keys like "Package","Version","Size"
packages_yum_postgresql_org(id PK, last_updated timestamp, yumdata jsonb)  -- JSONB; yumdata has keys like "name","version","size"

Views: film_list, customer_list, actor_info, nicer_but_slower_film_list, sales_by_store, sales_by_film_category.
Functions: film_in_stock(film_id,store_id), inventory_in_stock(inventory_id), get_customer_balance(customer_id, ts).

Notes:
- Full-text search on films uses the tsvector column: WHERE fulltext @@ to_tsquery('english','word').
- mpaa_rating is an enum; compare as text if needed.
- For JSONB, extract fields with ->> e.g. aptdata->>'Package'.
- Customer "active" status: activebool (boolean).`;
