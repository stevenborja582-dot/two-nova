import sys
from Xlib import display, X
from Xlib.ext import xtest
d = display.Display()
xtest.fake_input(d, X.MotionNotify, x=int(float(sys.argv[1])), y=int(float(sys.argv[2])))
d.sync()
