# leaf_overdraw_frame.py OVERDRAW.png HIDE.png : leaf fragments per crown pixel from the in-engine debug view (look
# "dbg_leaf": "overdraw" / "hide", place_dress.gd). The overdraw material adds 1/32 linear green per leaf fragment and the
# frame is sRGB-encoded, so the count is (lin(G_overdraw) - lin(G_hide)) * 32; mask = at least half a fragment. Prints the
# red shift too: if red moves as well, tone mapping or another difference confounds the count.
import sys
import numpy as np
from PIL import Image
o=np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(float)/255
h=np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(float)/255
lin=lambda c: np.where(c<=0.04045,c/12.92,((c+0.055)/1.055)**2.4)
dg8=(o[...,1]-h[...,1])*255
print('8-bit green diff histogram', list(zip([-300,-2,-0.5,0.5,1.5,2.5,5,10,20,40,80,160],np.histogram(dg8,bins=[-300,-2,-0.5,0.5,1.5,2.5,5,10,20,40,80,160,256])[0].tolist())))
print('R / B channel |diff|>2 px', int((np.abs(o[...,0]-h[...,0])*255>2).sum()), int((np.abs(o[...,2]-h[...,2])*255>2).sum()))
d=(lin(o[...,1])-lin(h[...,1]))*32
m=d>0.5; v=d[m]
print('crown mask px %d  frags/px mean %.2f p50 %.2f p95 %.2f max %.2f'%(m.sum(),v.mean(),np.median(v),np.percentile(v,95),v.max()))
sat=o[...,1]>=254/255; print('saturated green px in mask', int((sat&m).sum()))
dr=(lin(o[...,0])-lin(h[...,0]))*32
print('red shift over the mask, same units: mean %.2f' % dr[m].mean())
