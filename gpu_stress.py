#!/usr/bin/env python3
import ctypes as C
import sys
import time

lib = C.CDLL("libcuda.so.1")
CUresult = C.c_int

def fn(name, restype=CUresult, argtypes=()):
    f = getattr(lib, name)
    f.restype = restype
    f.argtypes = list(argtypes)
    return f

cuInit = fn("cuInit", argtypes=(C.c_uint,))
cuDeviceGet = fn("cuDeviceGet", argtypes=(C.POINTER(C.c_int), C.c_int))
cuCtxCreate = fn("cuCtxCreate_v2", argtypes=(C.POINTER(C.c_void_p), C.c_uint, C.c_int))
cuCtxDestroy = fn("cuCtxDestroy_v2", argtypes=(C.c_void_p,))
cuModuleLoadData = fn("cuModuleLoadData", argtypes=(C.POINTER(C.c_void_p), C.c_void_p))
cuModuleUnload = fn("cuModuleUnload", argtypes=(C.c_void_p,))
cuModuleGetFunction = fn("cuModuleGetFunction", argtypes=(C.POINTER(C.c_void_p), C.c_void_p, C.c_char_p))
cuMemAlloc = fn("cuMemAlloc_v2", argtypes=(C.POINTER(C.c_uint64), C.c_size_t))
cuMemFree = fn("cuMemFree_v2", argtypes=(C.c_uint64,))
cuLaunchKernel = fn("cuLaunchKernel", argtypes=(C.c_void_p, C.c_uint, C.c_uint, C.c_uint,
    C.c_uint, C.c_uint, C.c_uint, C.c_uint, C.c_void_p, C.POINTER(C.c_void_p), C.c_void_p))
cuCtxSynchronize = fn("cuCtxSynchronize")

PTX = r""".version 6.5
.target sm_75
.address_size 64
.visible .entry stress(
    .param .u64 iterations,
    .param .u64 output
)
{
    .reg .pred %p;
    .reg .b32 %r<4>;
    .reg .b64 %rd<7>;
    .reg .f32 %f<10>;
    ld.param.u64 %rd1, [iterations];
    ld.param.u64 %rd2, [output];
    mov.u32 %r1, %ctaid.x;
    mov.u32 %r2, %ntid.x;
    mov.u32 %r3, %tid.x;
    mad.lo.u32 %r0, %r1, %r2, %r3;
    cvt.u64.u32 %rd3, %r0;
    mov.u64 %rd4, 0;
    mov.f32 %f0, 1.001;
    mov.f32 %f1, 1.00001;
    mov.f32 %f2, 0.99999;
    mov.f32 %f3, 0.00001;
L:
    fma.rn.f32 %f0, %f0, %f1, %f3;
    fma.rn.f32 %f1, %f1, %f2, %f3;
    fma.rn.f32 %f2, %f2, %f0, %f3;
    fma.rn.f32 %f3, %f3, %f1, %f2;
    fma.rn.f32 %f4, %f0, %f1, %f2;
    fma.rn.f32 %f5, %f1, %f2, %f3;
    fma.rn.f32 %f6, %f2, %f3, %f4;
    fma.rn.f32 %f7, %f3, %f4, %f5;
    add.u64 %rd4, %rd4, 1;
    setp.lt.u64 %p, %rd4, %rd1;
    @%p bra L;
    shl.b64 %rd5, %rd3, 2;
    add.u64 %rd6, %rd2, %rd5;
    st.global.f32 [%rd6], %f7;
    ret;
}
"""

def check(rc, where):
    if rc != 0:
        raise RuntimeError(f"{where} failed with CUDA error {rc}")

duration = float(sys.argv[1]) if len(sys.argv) > 1 else 60.0
check(cuInit(0), "cuInit")
dev = C.c_int()
check(cuDeviceGet(C.byref(dev), 0), "cuDeviceGet")
ctx = C.c_void_p()
check(cuCtxCreate(C.byref(ctx), 0, dev), "cuCtxCreate")
module = C.c_void_p()
ptx_buf = C.create_string_buffer(PTX.encode())
try:
    check(cuModuleLoadData(C.byref(module), C.cast(ptx_buf, C.c_void_p)), "cuModuleLoadData")
    kernel = C.c_void_p()
    check(cuModuleGetFunction(C.byref(kernel), module, b"stress"), "cuModuleGetFunction")
    blocks, threads = 256, 256
    output = C.c_uint64()
    check(cuMemAlloc(C.byref(output), blocks * threads * 4), "cuMemAlloc")
    iterations = C.c_uint64(2_000_000)
    params = (C.c_void_p * 2)(C.cast(C.byref(iterations), C.c_void_p), C.cast(C.byref(output), C.c_void_p))
    end = time.monotonic() + duration
    launches = 0
    while time.monotonic() < end:
        check(cuLaunchKernel(kernel, blocks, 1, 1, threads, 1, 1, 0, C.c_void_p(0), params, C.c_void_p(0)), "cuLaunchKernel")
        check(cuCtxSynchronize(), "cuCtxSynchronize")
        launches += 1
    print(f"completed {launches} kernels in {duration:.1f}s", flush=True)
    check(cuMemFree(output), "cuMemFree")
finally:
    if module:
        cuModuleUnload(module)
    if ctx:
        cuCtxDestroy(ctx)
