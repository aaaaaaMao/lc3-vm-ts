import { readFileSync } from 'fs'
import * as readline from 'readline'

const rl = readline.createInterface({ 
  input: process.stdin, 
  output: process.stdout
})

let input = 'a'

async function sleep(milliseconds: number) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  })
}

async function readLine() {
  return new Promise(resolve => {
    rl.on('line', (data) => {
      input = data
      rl.pause()
      resolve(data)
    })
  })
}

const MEMORY_SIZE = 65536
const memory = new Uint16Array(MEMORY_SIZE)
type Uint16 = typeof memory[0]

enum Register {
  R_R0,
  R_R1,
  R_R2,
  R_R3,
  R_R4,
  R_R5,
  R_R6,
  R_R7,
  R_PC, /* program counter */
  R_COND,
  R_COUNT,
}
const registers = new Uint16Array(Register.R_COUNT)

enum OpCode {
  OP_BR = 0, /* branch */
  OP_ADD,    /* add  */
  OP_LD,     /* load */
  OP_ST,     /* store */
  OP_JSR,    /* jump register */
  OP_AND,    /* bitwise and */
  OP_LDR,    /* load register */
  OP_STR,    /* store register */
  OP_RTI,    /* unused */
  OP_NOT,    /* bitwise not */
  OP_LDI,    /* load indirect */
  OP_STI,    /* store indirect */
  OP_JMP,    /* jump */
  OP_RES,    /* reserved (unused) */
  OP_LEA,    /* load effective address */
  OP_TRAP    /* execute trap */
}

enum Flag {
  FL_POS = 1 << 0, /* P */
  FL_ZRO = 1 << 1, /* Z */
  FL_NEG = 1 << 2, /* N */
}

/** Memory Mapped Registers */
enum MMR {
  MR_KBSR = 0xFE00, /* keyboard status */
  MR_KBDR = 0xFE02  /* keyboard data */
}

enum Trap {
  TRAP_GETC = 0x20,  /* get character from keyboard, not echoed onto the terminal */
  TRAP_OUT = 0x21,   /* output a character */
  TRAP_PUTS = 0x22,  /* output a word string */
  TRAP_IN = 0x23,    /* get character from keyboard, echoed onto the terminal */
  TRAP_PUTSP = 0x24, /* output a byte string */
  TRAP_HALT = 0x25   /* halt the program */
}

/**
 * set the PC to starting position
 * 0x3000 is the default
 */
const PC_START = 0x3000
registers[Register.R_PC] = PC_START

let running = 1

async function main() {
  readImage('./temp/2048.obj')

  while (running) {
    const instr: Uint16 = await memRead(registers[Register.R_PC]++) /* FETCH */
    const op: Uint16 = instr >> 12
  
    switch (op) {
    case OpCode.OP_ADD: {
      add(instr)
      break
    }
    case OpCode.OP_AND: {
      bitwiseAnd(instr)
      break
    }
    case OpCode.OP_NOT: {
      bitwiseNot(instr)
      break
    }
    case OpCode.OP_BR: {
      branch(instr)
      break
    }
    case OpCode.OP_JMP: {
      jump(instr)
      break 
    }
    case OpCode.OP_JSR: {
      jumpRegister(instr)
      break
    }
    case OpCode.OP_LD: {
      await load(instr)
      break
    }
    case OpCode.OP_LDI: {
      await loadIndirect(instr)
      break
    }
    case OpCode.OP_LDR: {
      await loadRegister(instr)
      break
    }
    case OpCode.OP_LEA: {
      loadEffectiveAddress(instr)
      break
    }
    case OpCode.OP_ST: {
      store(instr)
      break
    }
    case OpCode.OP_STI: {
      await storeIndirect(instr)
      break
    }
    case OpCode.OP_STR: {
      storeRegister(instr)
      break
    }
    case OpCode.OP_TRAP: {
      trapHandler(instr)
      break
    }
    case OpCode.OP_RES:
    case OpCode.OP_RTI:
    default: {
      abort()
    }
    }
  }
}

main().catch(console.error)

function signExtend(x: Uint16, bitCount: number): Uint16 {
  if ((x >> (bitCount - 1)) & 1) {
    x |= (0xFFFF << bitCount)
  }
  return x
}

function updateFlags(r: Uint16) {
  if (registers[r] === 0) {
    registers[Register.R_COND] = Flag.FL_ZRO
  } else if (registers[r] >> 15) { /* a 1 in the left-most bit indicates negative */
    registers[Register.R_COND] = Flag.FL_NEG
  } else {
    registers[Register.R_COND] = Flag.FL_POS
  }
}

function add(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7 /* destination register (DR) */
  const r1: Uint16 = (instr >> 6) & 0x7 /* first operand (SR1) */
  const immFlag: Uint16 = (instr >> 5) & 0x1 /* whether we are in immediate mode */

  if (immFlag) {
    const imm5: Uint16 = signExtend(instr & 0x1F, 5)
    registers[r0] = registers[r1] + imm5
  } else {
    const r2: Uint16 = instr & 0x7
    registers[r0] = registers[r1] + registers[r2]
  }

  updateFlags(r0)
}

async function loadIndirect(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7 /* destination register (DR) */
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9) /* PCoffset 9*/

  /* add pc_offset to the current PC, look at that memory location to get the final address */
  registers[r0] = await memRead(await memRead(registers[Register.R_PC] + pcOffset))
  updateFlags(r0)
}

function abort() {
  process.exit(-1)
}

function bitwiseAnd(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7
  const immFlag: Uint16 = (instr >> 5) & 0x1

  if (immFlag) {
    const imm5: Uint16 = signExtend(instr & 0x1F, 5)
    registers[r0] = registers[r1] & imm5
  } else {
    const r2: Uint16 = instr & 0x7
    registers[r0] = registers[r1] & registers[r2]
  }
  updateFlags(r0)
}

function bitwiseNot(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7

  registers[r0] = ~registers[r1]
  updateFlags(r0)
}

function branch(instr: Uint16) {
  const pcOffset: Uint16 = signExtend((instr) & 0x1ff, 9)
  const condFlag: Uint16 = (instr >> 9) & 0x7
  if (condFlag & registers[Register.R_COND]) {
    registers[Register.R_PC] += pcOffset
  }
}

function jump(instr: Uint16) {
  /* Also handles RET */
  const r1: Uint16 = (instr >> 6) & 0x7
  registers[Register.R_PC] = registers[r1]
}

function jumpRegister(instr: Uint16) {
  const r1: Uint16 = (instr >> 6) & 0x7
  const longPCOffset: Uint16 = signExtend(instr & 0x7ff, 11)
  const longFlag: Uint16 = (instr >> 11) & 1

  registers[Register.R_R7] = registers[Register.R_PC]
  if (longFlag) {
    registers[Register.R_PC] += longPCOffset  /* JSR */
  } else {
    registers[Register.R_PC] = registers[r1] /* JSRR */
  }
}

async function load(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  registers[r0] = await memRead(registers[Register.R_PC] + pcOffset)
  updateFlags(r0)
}

async function loadRegister(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7
  const offset: Uint16 = signExtend(instr & 0x3F, 6)
  registers[r0] = await memRead(registers[r1] + offset)
  updateFlags(r0)
}

function loadEffectiveAddress(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  registers[r0] = registers[Register.R_PC] + pcOffset
  updateFlags(r0)
}

function store(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  memWrite(registers[Register.R_PC] + pcOffset, registers[r0])
}

async function storeIndirect(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const pcOffset: Uint16 = signExtend(instr & 0x1ff, 9)
  memWrite(await memRead(registers[Register.R_PC] + pcOffset), registers[r0])
}

function storeRegister(instr: Uint16) {
  const r0: Uint16 = (instr >> 9) & 0x7
  const r1: Uint16 = (instr >> 6) & 0x7
  const offset: Uint16 = signExtend(instr & 0x3F, 6)
  memWrite(registers[r1] + offset, registers[r0])
}

function trapHandler(instr: Uint16) {
  switch (instr & 0xFF) {
  case Trap.TRAP_GETC: {
    /* read a single ASCII char */
    registers[Register.R_R0] = getchar()
    break
  }
  case Trap.TRAP_OUT: {
    console.log(Buffer.from([registers[Register.R_R0]]).toString('utf8'))
    break
  }
  case Trap.TRAP_PUTS: {
    /* one char per word */
    let pos: Uint16 = registers[Register.R_R0]
    let char = memory[pos]
    const buf = []
    while (char) {
      buf.push(char)
      pos++
      char = memory[pos]
    }
    console.log(Buffer.from(buf).toString('utf8'))
    break
  }
  case Trap.TRAP_IN: {
    console.log('Enter a character: ')
    const c = getchar()
    console.log(c)
    registers[Register.R_R0] = c
    break
  }
  case Trap.TRAP_PUTSP: {
    /* one char per byte (two bytes per word) here we need to swap back to
       big endian format */
    let pos: Uint16 = registers[Register.R_R0]
    let char = memory[pos]

    while (char) {
      const char1 = char & 0xFF
      console.log(char1)
      const char2 = char >> 8
      if (char2) console.log(char2)
      pos++
      char = memory[pos]
    }
    break
  }
  case Trap.TRAP_HALT: {
    console.log('HALT')
    running = 0
  }
  }
}

function getchar(): Uint16 {
  const char = Buffer.from(input[0]).readUInt8() & 0xFF
  input = 'a'
  // rl.resume()
  return char
}

function memWrite(address: Uint16, val: Uint16) {
  memory[address] = val
}

async function memRead(address: Uint16): Promise<Uint16> {
  if (address === MMR.MR_KBSR) {
    if (await checkKey()) {
      memory[MMR.MR_KBSR] = (1 << 15)
      memory[MMR.MR_KBDR] = getchar()
    } else {
      memory[MMR.MR_KBSR] = 0x00
    }
  }
  return memory[address]
}

async function checkKey(): Promise<boolean> {
  await Promise.race([sleep(100)])
  return !!input.length
}

function readImage(imagePath: string) {
  const image = readFileSync(imagePath)

  /* the origin tells us where in memory to place the image */
  const origin: Uint16 = image.readUInt16BE(0)

  /* we know the maximum file size so we only need one fread */
  // const maxRead: Uint16 = MEMORY_SIZE - origin
  let pos = 0

  while ((pos + 1) * 2 < image.length) {
    memory[origin + pos] = image.readUInt16BE((pos + 1) * 2)
    pos++
  }
}
