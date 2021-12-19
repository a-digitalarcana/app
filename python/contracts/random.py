import smartpy as sp
 
# Mask off the lower bits of the provided value.
def lower(value, mask):
    return value & mask;
    # SmartPy.io/ide doesn't handle bitwise AND properly, so we need to use MOD for testing.
    #return value % (mask + 1); # assume mask is all 1s
 
def lower7(value):
    return lower(value, 0x7F)
 
def lower16(value):
    return lower(value, 0xFFFF)
 
def lower32(value):
    return lower(value, 0xFFFFFFFF)
 
def new_contract_address_as_bytes():
    # Leverage CREATE_CONTRACT to generate a new contract address to use as our seed.
    contract = sp.create_contract_operation(sp.Contract(), sp.unit, sp.tez(0), None)
    return sp.pack(contract.address)
    
class Random(sp.Contract):
    def __init__(self):
        self.init(
            hash = sp.bytes('0x'), # remove
            nat_value = 0,
            bytes_to_nat = { sp.bytes("0x%0.2X" % n): sp.nat(n)
                for n in range(256) },
            results = sp.list([], sp.TNat)
        )
 
    def bytes_to_nat(self, bytes):
        # Iterate over each byte, look up the corresponding nat value from our table,
        # and accumulate into our result.
        i = sp.local('i', 0)
        result = sp.local('result', 0)
        bytes_len = sp.local('bytes_len', sp.len(bytes))
        sp.while i.value < bytes_len.value:
            byte_value = self.data.bytes_to_nat[sp.slice(bytes, i.value, 1).open_some()]
            result.value = result.value * 256 + byte_value
            i.value = i.value + 1
        return result.value
 
    @sp.entry_point
    def run(self):
        # Use the lower 7 bits of the previous hash to select the new hash seed window.
        # A contract address is 28 bytes = 224 bits, so 128 bits + 2x32 bit seeds = 192.
        # That leaves us a buffer of 32 bits unused, which don't change much anyway.
        # (e.g. all contracts start with KT1...)
        shift = sp.local('shift', lower7(self.data.nat_value))
 
        # Generate seed using a new contract address.
        self.data.hash = new_contract_address_as_bytes()
        self.data.nat_value = self.bytes_to_nat(self.data.hash)
 
        # Seed RNG
        z = sp.local('z', lower32(self.data.nat_value >> shift.value))
        w = sp.local('w', lower32(self.data.nat_value >> shift.value + 32))
 
        # Store a set of random values
        self.data.results = []
        j = sp.local('j', 0)
        sp.while j.value < 256:
            z.value = lower32(36969 * lower16(z.value) + (z.value >> 16))
            w.value = lower32(18000 * lower16(w.value) + (w.value >> 16))
            self.data.results.push(lower32((z.value << 16) + w.value))
            j.value = j.value + 1
 
@sp.add_test(name = "test")
def test():
    scenario = sp.test_scenario()
    c1 = Random()
    scenario += c1
    #c1.run()
    #for n in range(10):
    #    c1.multiply_with_carry()

