# Apne computer par free me test karna

Hosting ya domain ke bina, poora system apne computer par chala sakte ho. Do tareeke hain; pehla aasan hai.

## Tareeka 1: Docker Desktop (sabse aasan)

1. Docker Desktop install karo: https://www.docker.com/products/docker-desktop/ (Windows aur Mac ke liye free). Install ke baad use ek baar khol do.
2. GitHub se code download karo: repo page par hara "Code" button → "Download ZIP" → ZIP ko kisi folder me extract karo.
3. Us folder me terminal kholo (Windows: folder ke address bar me `cmd` likh kar Enter).
4. Ye command chalao:

   ```
   docker compose -f docker-compose.local.yml up --build
   ```

   Pehli baar 5-10 minute lagenge. Jab `Ready` ya `started server` dikhe, tab taiyar hai.
5. Browser me kholo: http://localhost:3000

Band karne ke liye terminal me `Ctrl + C`. Dobara chalane ke liye wahi command (ab jaldi chalega).
Sab data mita kar naye sire se shuru karna ho: `docker compose -f docker-compose.local.yml down -v`

Ye Docker file likhi gayi hai par jis jagah app bana wahan Docker nahi tha, isliye ise wahan chalakar nahi dekha gaya. Agar pehli baar error aaye to error ka text bhej do.

## Tareeka 2: Bina Docker ke

1. Node.js (version 20 ya upar) install karo: https://nodejs.org
2. PostgreSQL install karo: https://www.postgresql.org/download/ (install ke waqt jo password rakho wo yaad rakhna).
3. PostgreSQL me `sfa` naam ka database banao (pgAdmin se: Databases → Create → Database).
4. Code ke folder me `.env.example` ki copy banao, naam `.env` rakho, aur ye line badlo (PASSWORD ki jagah apna password):

   ```
   DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/sfa
   AUTH_SECRET=koi-bhi-lamba-random-text-kam-se-kam-16-akshar
   COOKIE_SECURE=false
   ```
5. Terminal me ye chalao:

   ```
   npm install
   npm run migrate
   npm run seed -- --sample
   npm run demo
   npm run build
   npm start
   ```

   `npm run demo` 6 mahine ke order, batch-wise stock, distributor stock report, baaki (outstanding), visit, claim, rebate slab aur target bhar deta hai, taki har screen bhari hui dikhe. Khali system dekhna ho to ye line chhod do.
6. Browser me kholo: http://localhost:3000

## Login

| Kaun | Login | Password |
| --- | --- | --- |
| Admin | ADMIN | Everest@123 |
| General Manager | GM01 | Everest@123 |
| Credit Control | CC01 | Everest@123 |
| RSM (Central) | RSM01 | Everest@123 |
| ASM (Birgunj) | ASM01 | Everest@123 |
| Sales Officer (Birgunj) | SO01 | Everest@123 |
| Sales Officer (Biratnagar) | SO02 | Everest@123 |

ADMIN ko pehli baar login par password badalna padega (tab tak koi aur screen nahi khulegi). Sample users (GM01, SO01 ...) seedha chal jayenge.

## Kya test karna hai (ek poora chakkar)

Alag-alag role ke liye alag browser ya "Incognito/Private window" use karo, taki ek saath do log login rah saken.

1. **SO01**: "My visits" → kisi customer par Check in → "Take order" ya "Repeat last order" → purpose/remarks → Check out. "Sales opportunities" bhi dekho.
2. **ASM01**: "Team visits" me SO01 dikhega; "Day on map" se uska rasta; "Alerts" me flag dikhenge.
3. **CC01**: "Credit control" → "Outstanding upload" → template download karo, 2-3 customer ke aankde bharo, upload karo.
4. **SO01**: "Booklets" → New booklet → base rate se kam rate dalo → Submit.
5. **ASM01 / RSM01 / GM01**: "Booklets" → To approve → Approve (kitna neeche rate hai us hisab se kahan tak jayega).
6. **SO01**: "Sales orders" → New sales order → approved booklet chuno → Submit.
7. **CC01**: "Credit control" → Order queue → Approve → "Dispatch" → Excel download → Mark dispatched.
8. **SO01**: "Collections" aur "Claims" me ek-ek entry.
9. **GM01**: Dashboard (control room), "Targets and scorecard" me target dalo, "Reports" se Excel nikalo.
10. **ADMIN**: "Roles and permissions", "Settings", "Audit log".

### Stock, expiry, scheme aur returns ka chakkar

11. **CC01**: "Stock and expiry" → "Upload stock" → template download karo. Usme 3-4 line bharo: product code (jaise `NS500`), batch, expiry (ek batch 4 mahine baad ki, ek 2 saal baad ki), boxes. Upload karo. "Expiry position" me seedhi aur "Will not sell in time" dekho.
12. **SO01**: "Stock and expiry" → 4 mahine wale batch par "Find buyers" → "Create order". Order offer rate par banega aur "non-returnable" likha aayega.
13. **GM01**: "Schemes" → Add → product chuno, minimum 20 boxes, bonus 10 + 1, aaj se 30 din. Phir **SO01** us product ka 28 boxes ka order banaye: free boxes aur "Add 2 more boxes" ka ishara dikhega.
14. **GM01**: "Price lists" → Add → ek product ka Hospital ya Distributor rate. Us type ke customer ke order me wahi rate apne aap aayega.
15. **SO01**: "Distributor stock" → ek distributor ka stock aur 30 din ki bikri bharo → "Sales orders" → New → "Suggested order". Bahut zyada boxes daal kar overstock ki chetavni dekho. "Quick entry" bhi try karo.
16. **SO01**: "Claims" → Near expiry claim: bina batch/expiry ke, ya door ki expiry ke saath mana hoga. Sahi claim par **GM01** ko "Policy check" dikhega.
17. **GM01**: "Yearly rebate" → slab daalo (jaise 1,00,000 par 1%, 5,00,000 par 2%). "Approvals" me sab kuch ek jagah. "Stock and expiry" → "Loss and returns" aur "Short stock". "Scheme results". Dashboard par "Sales and loss today".
18. **SO01**: "Sales opportunities" → Action list me Done / Later / Not interested. Kisi customer ka naam kholo: class, returns allowance, rate aur scheme dikhenge.

## Computer par test ki seema

- **Location**: `localhost` par browser location deta hai, par computer me GPS nahi hota, isliye location Wi-Fi se andaze wali aati hai (kabhi 1-2 km galat). Geo-fence ka sahi test phone par hi hoga.
- **Phone se test**: phone ke browser ko location ke liye `https` chahiye, jo sirf hosting ke baad milega. Tab tak phone par baaki sab screen dekh sakte ho (computer ka IP address:3000), par location wale button kaam nahi karenge.
- **Map**: map ki tasveer internet se aati hai, isliye internet chalu rakho.
- Sample data ke naam me "Sample" likha hai. Asli data dalne se pehle database mita kar `npm run seed` (bina `--sample`) chalana.
