type Point = Readonly<{x:number;y:number}>;

function magnitudeSquared(point:Point):number{
  return point.x*point.x+point.y*point.y;
}

describe('OpenContainer frozen Vitest compatibility fixture',()=>{
  it('executes TypeScript syntax and assertions through real Vitest',()=>{
    const point:Point={x:3,y:4};
    expect(magnitudeSquared(point)).toBe(25);
  });

  it('supports async test execution',async()=>{
    const value=await Promise.resolve({ok:true,value:42});
    expect(value).toEqual({ok:true,value:42});
  });

  it('keeps deterministic data transforms',()=>{
    const rows=[3,1,2].map(value=>({value,key:String(value)}));
    rows.sort((a,b)=>a.value-b.value);
    expect(rows.map(row=>row.key)).toEqual(['1','2','3']);
  });
});
