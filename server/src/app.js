import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import { nfzQueues, gusUnits } from './external.js';
export const app=express();
app.use(cors({origin:process.env.CLIENT_ORIGIN || 'http://localhost:5173'}));
app.use(express.json());
app.get('/api/health',(_req,res)=>res.json({ok:true,database:'sqlite'}));
app.get('/api/facilities',(req,res)=>{
 const city=String(req.query.city||'').trim();
 const rows=city ? db.prepare('SELECT * FROM facilities WHERE city LIKE ? ORDER BY name LIMIT 100').all(`%${city}%`)
  :db.prepare('SELECT * FROM facilities ORDER BY name LIMIT 100').all();
 res.json({data:rows});
});
app.get('/api/facilities/:id',(req,res)=>{
 const row=db.prepare('SELECT * FROM facilities WHERE id=?').get(req.params.id);
 if(!row)return res.status(404).json({error:'Nie znaleziono placówki'});
 res.json({data:row});
});

app.get('/api/nfz/queues', async (req, res, next) => {
  try {
    const {
      province = '07',
      benefit = '',
      case: caseType = '1',
      limit = '50',
      page = '1'
    } = req.query;

    const provinceValue = String(province).trim();
    const benefitValue = String(benefit).trim();
    const limitValue = String(limit).trim();
    const pageValue = String(page).trim();
    const caseValue = String(caseType).trim();

    const valid =
      /^(0[1-9]|1[0-6])$/.test(provinceValue) &&
      /^\d+$/.test(limitValue) &&
      Number(limitValue) >= 1 &&
      Number(limitValue) <= 100 &&
      /^[1-9]\d*$/.test(pageValue) &&
      ['1', '2'].includes(caseValue) &&
      benefitValue.length <= 150;

    if (!valid) {
      return res.status(400).json({
        error: 'Nieprawidłowe parametry',
        received: {
          province: provinceValue,
          benefit: benefitValue,
          limit: limitValue,
          page: pageValue,
          case: caseValue
        }
      });
    }

    const params = {
      province: provinceValue,
      case: caseValue,
      limit: limitValue,
      page: pageValue
    };

    if (benefitValue) {
      params.benefit = benefitValue;
    }

    const result = await nfzQueues(params);

    return res.json(result);

  } catch (error) {
    next(error);
  }
});

app.get('/api/gus/units',async(req,res,next)=>{
 try {
  const name=String(req.query.name||'Poznań').trim();
  if(!name||name.length>100)return res.status(400).json({error:'Nieprawidłowa nazwa'});
  res.json(await gusUnits({name,'page-size':20,page:0}));
 }catch(e){next(e);}
});
app.use((err,_req,res,_next)=>{console.error(err.message);res.status(err.status||500).json({error:err.message||'Błąd serwera'});});
